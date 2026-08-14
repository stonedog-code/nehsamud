/**
 * Retry the one thing at boot that depends on something outside this process:
 * reaching the database (NEH-714).
 *
 * WHY THIS EXISTS
 *
 * The engine runs as a Lightsail container alongside pgbouncer, and a Lightsail
 * deployment activates as a UNIT — if this container exits, the whole
 * deployment fails and every sibling container goes with it. On 2026-08-14 that
 * happened three times in one afternoon, and one of the three was a web release
 * containing no MUD work at all: `hopper-dal` + `apps/web` + a Caddy fix, killed
 * by an engine that could not read `mud.room` at boot.
 *
 * The specific bug that day was ours (demanding TLS on a loopback connection,
 * fixed in #30). This is not a fix for that bug — it is the reason that class of
 * bug was able to take unrelated releases down with it. A first-attempt failure
 * against a sidecar that may still be starting is not evidence the database is
 * unreachable; it is evidence we asked too early.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not retry forever, and it does not swallow the error. A database that
 * is genuinely misconfigured still fails the boot, with the LAST error, after a
 * bounded wait — because a container that starts happily without the data it
 * serves is worse than one that refuses: it would answer requests with an empty
 * world and look healthy doing it.
 */

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the 2nd attempt; doubles each time, capped by maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests can assert what an operator would see. */
  log?: (line: string) => void;
}

const DEFAULTS = {
  // ~31s of waiting across 6 attempts (1+2+4+8+16), comfortably inside
  // Lightsail's activation window, and far longer than pgbouncer needs.
  attempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 16_000,
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on failure with exponential backoff.
 *
 * Every attempt is logged as one JSON line, because the only person who ever
 * reads this is looking at a container log wondering why a deployment failed.
 * A silent retry loop would turn "boot failed" into "boot hung", which is
 * harder to diagnose, not easier.
 */
export async function withBootRetry<T>(
  what: string,
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((line: string) => console.warn(line));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log(
        JSON.stringify({
          msg: "boot retry",
          what,
          attempt,
          of: attempts,
          retryInMs: delay,
          error: String(err),
        }),
      );
      await sleep(delay);
    }
  }
  // Rethrow the LAST error, not a wrapper: the caller's `boot failed` line is
  // what an operator greps for, and it must still name the real cause.
  throw lastError;
}
