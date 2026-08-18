/**
 * The socket-wait helpers, tested against a socket whose replies are
 * deliberately late.
 *
 * These exist because of NEH-924: `mud-smoke` and `ws-server-create` passed
 * in nehsamud's own checkout and failed under the hopperguard monorepo's
 * unit tier, where ~30 jest projects compete for the CPU. The suites were
 * not asserting the engine's behaviour so much as the machine's load — an
 * idle-timeout drain resolves EMPTY when a reply is late, and every
 * `expect(lines.some(...)).toBe(true)` downstream of it fails as
 * `Expected: true / Received: false`.
 *
 * Non-vacuity was measured, not assumed: with the helpers reverted to the
 * old idle-only behaviour, six of the seven cases below go red. The seventh
 * ("detaches its listener") still passes, because listener hygiene is not
 * what changed — it is here to stop the fix leaking listeners, not to
 * discriminate old from new. The delays are all far larger than the idle
 * window, so that discrimination does not itself depend on timing.
 */

import { EventEmitter } from "node:events";
import type WebSocket from "ws";

import {
  collectFrom,
  drainUntil,
  drainUntilSilent,
  parseMessages,
} from "./support/ws-drain.js";

/**
 * The slice of `ws` the helpers touch: `on`, `off`, and `message` events
 * carrying raw frames. A real server is unnecessary and would reintroduce
 * the very scheduling noise these tests exist to be immune to.
 */
class FakeSocket extends EventEmitter {
  send(message: string): void {
    this.emit("message", Buffer.from(JSON.stringify({ type: "SERVER_MESSAGE", message })));
  }

  /** Deliver `message` after `ms`, well outside any idle window. */
  sendAfter(ms: number, message: string): NodeJS.Timeout {
    return setTimeout(() => this.send(message), ms);
  }

  get asSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

/** Deliberately much longer than the 50ms idle window the drains sweep with. */
const LATE_MS = 300;

describe("ws-drain — waiting on a condition, not on the clock", () => {
  it("drainUntil resolves on a reply that arrives long after the idle window", async () => {
    const sock = new FakeSocket();
    sock.sendAfter(LATE_MS, "the race choices are dwarf, human");

    const lines = parseMessages(
      await drainUntil(sock.asSocket, (m) =>
        m.some((l) => l.includes("race choices")),
      ),
    );

    // The old idle-only drain resolved after 50ms of silence and returned
    // [], so this assertion read `false` — NEH-924's exact symptom.
    expect(lines.some((l) => l.includes("race choices"))).toBe(true);
  });

  it("drainUntilSilent waits for a first frame before it starts timing quiet", async () => {
    const sock = new FakeSocket();
    sock.sendAfter(LATE_MS, "a late settle frame");

    const frames = await drainUntilSilent(sock.asSocket);

    expect(frames).toHaveLength(1);
  });

  it("sweeps the rest of the burst once the predicate is satisfied", async () => {
    const sock = new FakeSocket();
    sock.sendAfter(LATE_MS, "Welcome, Aelric");
    // The room render trails the welcome inside the same burst.
    sock.sendAfter(LATE_MS + 5, "Town Square");

    const lines = parseMessages(
      await drainUntil(sock.asSocket, (m) =>
        m.some((l) => l.includes("Welcome, Aelric")),
      ),
    );

    expect(lines).toEqual(["Welcome, Aelric", "Town Square"]);
  });

  it("drainUntil fails with what it actually saw when the reply never comes", async () => {
    // The other direction of the guard: it must still fail when the thing
    // being waited for genuinely does not arrive, and say so legibly rather
    // than as `Expected: true / Received: false`.
    const sock = new FakeSocket();
    sock.sendAfter(20, "You can't go that way.");

    await expect(
      drainUntil(sock.asSocket, (m) => m.some((l) => l.includes("Town Square")), {
        timeoutMs: 250,
        label: "the room render",
      }),
    ).rejects.toThrow(/timed out after 250ms waiting for the room render[\s\S]*can't go that way/);
  });

  it("detaches its listener, so a later wait does not re-read old frames", async () => {
    const sock = new FakeSocket();
    sock.sendAfter(10, "first");
    await drainUntilSilent(sock.asSocket);
    expect(sock.listenerCount("message")).toBe(0);
  });

  it("a collector waits for a broadcast rather than reading at an arbitrary moment", async () => {
    const listener = new FakeSocket();
    const collector = collectFrom(listener.asSocket);
    listener.sendAfter(LATE_MS, 'Aria says "hello there"');

    const heard = parseMessages(
      await collector.until((m) => m.some((l) => l.includes("Aria says"))),
    );

    // Read at the moment the SPEAKER's socket went quiet, this was [] and
    // the "B heard it" assertion failed; the "B did not hear it" assertions
    // passed vacuously, which is the worse half.
    expect(heard).toEqual(['Aria says "hello there"']);
    expect(collector.stop()).toHaveLength(1);
    expect(listener.listenerCount("message")).toBe(0);
  });

  it("a collector fails with what it saw when the broadcast never arrives", async () => {
    const listener = new FakeSocket();
    const collector = collectFrom(listener.asSocket);
    listener.sendAfter(10, "something else entirely");

    await expect(
      collector.until((m) => m.some((l) => l.includes("Aria says")), {
        timeoutMs: 200,
        label: "Aria's say broadcast",
      }),
    ).rejects.toThrow(/timed out after 200ms waiting for Aria's say broadcast[\s\S]*something else entirely/);
    collector.stop();
  });
});
