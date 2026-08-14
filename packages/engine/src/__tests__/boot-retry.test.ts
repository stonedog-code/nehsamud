/**
 * NEH-714 — the engine must survive a database that is not ready yet.
 *
 * A Lightsail deployment activates as a unit, so this container exiting takes
 * every sibling with it. Three deployments died that way on 2026-08-14, one of
 * them a web release with no MUD content in it at all.
 *
 * These tests inject `sleep`, so they assert the retry POLICY without waiting
 * for it — a suite that actually slept 31 seconds would be one nobody runs.
 */
import { withBootRetry } from "../boot-retry.js";

const noSleep = async (): Promise<void> => {};

describe("withBootRetry", () => {
  it("returns the value on the first try, with no retry and no noise", async () => {
    const log = jest.fn();
    const fn = jest.fn(async () => "world");

    await expect(withBootRetry("load", fn, { sleep: noSleep, log })).resolves.toBe("world");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("recovers when the database becomes reachable on a later attempt", async () => {
    // THE CASE THIS EXISTS FOR: pgbouncer is still starting, so the first read
    // fails and the second succeeds.
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("Error opening a TLS connection");
      return "world";
    });

    await expect(withBootRetry("load", fn, { sleep: noSleep, log: jest.fn() })).resolves.toBe(
      "world",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("still fails, with the LAST error, when the database is genuinely broken", async () => {
    // Retrying must not become "never fail". A container that boots without the
    // data it serves would answer requests with an empty world and look healthy.
    const fn = jest.fn(async () => {
      throw new Error("password authentication failed");
    });

    await expect(
      withBootRetry("load", fn, { attempts: 3, sleep: noSleep, log: jest.fn() }),
    ).rejects.toThrow("password authentication failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially, capped", async () => {
    const delays: number[] = [];
    const fn = jest.fn(async () => {
      throw new Error("nope");
    });

    await expect(
      withBootRetry("load", fn, {
        attempts: 6,
        baseDelayMs: 1_000,
        maxDelayMs: 4_000,
        sleep: async (ms: number) => {
          delays.push(ms);
        },
        log: jest.fn(),
      }),
    ).rejects.toThrow("nope");

    // 1s, 2s, 4s, then capped at 4s. Five waits for six attempts — it does not
    // sleep after the last one, which is what makes the total bounded.
    expect(delays).toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  it("logs every retry as one JSON line naming the real error", async () => {
    // The only reader of this is someone staring at a container log asking why
    // a deployment failed. A silent retry turns "boot failed" into "boot hung".
    const log = jest.fn();
    const fn = jest.fn(async () => {
      throw new Error("Error opening a TLS connection");
    });

    await expect(
      withBootRetry("world.load", fn, { attempts: 2, sleep: noSleep, log }),
    ).rejects.toThrow();

    expect(log).toHaveBeenCalledTimes(1); // one retry between two attempts
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line).toMatchObject({ msg: "boot retry", what: "world.load", attempt: 1, of: 2 });
    expect(line.error).toContain("Error opening a TLS connection");
    expect(typeof line.retryInMs).toBe("number");
  });
});
