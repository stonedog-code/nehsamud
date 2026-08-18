/**
 * Waiting for a WebSocket reply, without a wall clock.
 *
 * Every socket test in this package used to wait the same way: attach a
 * `message` listener and resolve once no frame had arrived for ~50ms. That
 * reads like "wait for the reply" and is not — it is "wait 50ms and report
 * whatever happened to show up". On an idle laptop the reply lands in a
 * millisecond and the two are indistinguishable. On a loaded box they are
 * not: the hopperguard monorepo runs this suite as one of ~30 concurrent
 * jest projects, the reply arrives after the window has closed, the drain
 * resolves EMPTY, and the assertion fails as
 *
 *     expect(received).toBe(expected)   Expected: true   Received: false
 *
 * with nothing whatsoever to suggest that the reply was merely late. That
 * is NEH-924, and it is a property of the harness rather than the engine —
 * the same suite passes in nehsamud's own checkout because that run is not
 * competing for the CPU.
 *
 * The fix is to wait for the thing being asserted instead of for the clock.
 * `drainUntil` resolves as soon as the frames received satisfy the caller's
 * predicate; the timeout that remains is a failure cap, not the mechanism.
 * That distinction is the whole point: raising a cap can never turn a red
 * run green here, because a satisfied predicate has already resolved, so
 * there is no timeout left to tune away a real failure.
 */

import type WebSocket from "ws";

/** Quiet period used to sweep the rest of a burst once the wait is done. */
export const DEFAULT_IDLE_MS = 50;

/**
 * Failure cap. Reaching it means the reply never came — a hang or a real
 * defect — never "the machine was busy". Suites using these helpers must
 * set a jest timeout comfortably above it, or jest's own generic timeout
 * fires first and throws away the diagnostic below.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Predicate over the SERVER_MESSAGE lines received so far. */
export type Predicate = (messages: string[]) => boolean;

export interface WaitOptions {
  /** Quiet period used to sweep the rest of a burst. */
  idleMs?: number;
  /** Failure cap in ms. */
  timeoutMs?: number;
  /** Named in the timeout message, so a failure says what was awaited. */
  label?: string;
}

/** The SERVER_MESSAGE text carried by a batch of raw frames. */
export function parseMessages(frames: string[]): string[] {
  return frames
    .map((f) => JSON.parse(f) as { type: string; message?: string })
    .filter((p) => p.type === "SERVER_MESSAGE")
    .map((p) => p.message ?? "");
}

interface CoreOptions extends WaitOptions {
  /** True once the frames seen so far are enough to stop waiting. */
  ready: (frames: string[]) => boolean;
  /** What to do at the cap: surface a diagnostic, or hand back what we have. */
  onTimeout: "reject" | "resolve";
  /** Human description of what `ready` is waiting for. */
  awaiting: string;
}

function drainCore(
  sock: WebSocket,
  { ready, onTimeout, awaiting, idleMs = DEFAULT_IDLE_MS, timeoutMs = DEFAULT_TIMEOUT_MS, label }: CoreOptions,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    let idleTimer: NodeJS.Timeout | undefined;
    let capTimer: NodeJS.Timeout | undefined;
    let satisfied = false;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      sock.off("message", onMessage);
      if (idleTimer) clearTimeout(idleTimer);
      if (capTimer) clearTimeout(capTimer);
      if (error) reject(error);
      else resolve(frames);
    };

    // Once the wait is satisfied, keep listening for `idleMs` so the rest of
    // the same burst is swept up rather than left for the next drain to
    // find. This tail cannot reintroduce the race it replaces: what the
    // caller asserts on is already in `frames` before the tail starts.
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), idleMs);
    };

    const check = (): void => {
      if (!satisfied) satisfied = ready(frames);
      if (satisfied) armIdle();
    };

    const onMessage = (raw: WebSocket.RawData): void => {
      frames.push(raw.toString());
      check();
    };

    sock.on("message", onMessage);
    // A predicate can be satisfied by the empty set (a caller waiting for
    // "nothing in particular"); check once before waiting on a frame that
    // may never come.
    check();

    capTimer = setTimeout(() => {
      if (onTimeout === "resolve") {
        finish();
        return;
      }
      const seen = parseMessages(frames);
      finish(
        new Error(
          `timed out after ${timeoutMs}ms waiting for ${label ?? awaiting}.\n` +
            `Received ${frames.length} frame(s); SERVER_MESSAGE lines:\n` +
            (seen.length ? seen.map((l) => `  - ${l}`).join("\n") : "  (none)"),
        ),
      );
    }, timeoutMs);
  });
}

/**
 * Resolve once the SERVER_MESSAGE lines delivered satisfy `done`, plus a
 * short quiet tail to sweep the rest of the burst.
 *
 * Throws a diagnostic naming what was awaited and listing what arrived, so a
 * genuine failure is legible instead of `Expected: true / Received: false`.
 */
export function drainUntil(
  sock: WebSocket,
  done: Predicate,
  options: WaitOptions = {},
): Promise<string[]> {
  return drainCore(sock, {
    ...options,
    ready: (frames) => done(parseMessages(frames)),
    onTimeout: "reject",
    awaiting: "a matching SERVER_MESSAGE",
  });
}

/**
 * Settle the socket: wait for the reply to start arriving, then for it to
 * stop. Use where the frames are not asserted on and the step merely has to
 * complete before the next one is sent.
 *
 * Unlike `drainUntil` this resolves at the cap rather than throwing —
 * "nothing came back" is a legitimate outcome for a step whose only job is
 * to leave the socket quiet, and turning that into a failure would make the
 * helper unusable for the settle case it exists to serve.
 */
export function drainUntilSilent(
  sock: WebSocket,
  options: WaitOptions = {},
): Promise<string[]> {
  return drainCore(sock, {
    ...options,
    ready: (frames) => frames.length > 0,
    onTimeout: "resolve",
    awaiting: "any frame",
  });
}

/**
 * Start recording frames NOW, and hand back a handle to read them.
 *
 * `drainUntil` cannot observe a broadcast caused by SOMEONE ELSE's command:
 * by the time the speaker's own wait has resolved and a listener is attached
 * to the listener's socket, their frame has already arrived and been dropped
 * — `ws` does not buffer for a listener attached later. Every "B heard it"
 * assertion silently read an empty array, and every "B did NOT hear it"
 * assertion passed vacuously, which is the worse half: those tests would
 * still be green with the broadcast wired to the wrong room.
 *
 * So a recipient's collector must be attached BEFORE the speaker sends —
 * and then `until()` waited on, rather than read at whatever moment the
 * speaker's own socket happened to go quiet.
 */
export interface Collector {
  /** Snapshot of the frames received so far. Does not detach. */
  read(): string[];
  /** Resolve once the collected SERVER_MESSAGE lines satisfy `done`. */
  until(done: Predicate, options?: WaitOptions): Promise<string[]>;
  /** Detach and return everything collected. */
  stop(): string[];
}

export function collectFrom(sock: WebSocket): Collector {
  const frames: string[] = [];
  const onMessage = (raw: WebSocket.RawData): void => {
    frames.push(raw.toString());
  };
  sock.on("message", onMessage);

  return {
    read: () => [...frames],
    stop: () => {
      sock.off("message", onMessage);
      return [...frames];
    },
    until: async (done, options = {}) => {
      const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        idleMs = DEFAULT_IDLE_MS,
        label,
      } = options;
      const deadline = Date.now() + timeoutMs;
      while (!done(parseMessages(frames))) {
        if (Date.now() >= deadline) {
          const seen = parseMessages(frames);
          throw new Error(
            `timed out after ${timeoutMs}ms waiting for ${label ?? "a matching SERVER_MESSAGE"} on a collected socket.\n` +
              `Received ${frames.length} frame(s); SERVER_MESSAGE lines:\n` +
              (seen.length
                ? seen.map((l) => `  - ${l}`).join("\n")
                : "  (none)"),
          );
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      // Same burst-sweeping tail as `drainUntil`, for the same reason.
      await new Promise((r) => setTimeout(r, idleMs));
      return [...frames];
    },
  };
}
