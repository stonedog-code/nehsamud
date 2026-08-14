/**
 * The server-side command rate limit (PRD-0001 R21/R22).
 *
 * This exists because scripting is CLIENT-side. `ScriptRunner`'s budget is a
 * good defence against the scripts it runs and no defence at all against a
 * third-party client in C# or Python, which opens the same socket and sends
 * whatever it likes. So the test that matters most is not "does it refuse" —
 * it is that the refusal is cheap, that a normal player never meets it, and
 * that the number it reports back is one a client can actually obey.
 */

import {
  BURST_CAPACITY,
  COMMANDS_PER_SECOND,
  RateLimiter,
  throttleMessage,
} from "../rate-limit.js";

/** A limiter whose clock this test drives by hand. */
function limiter(over: { capacity?: number; perSecond?: number } = {}) {
  let now = 1_000_000;
  const rl = new RateLimiter({ ...over, now: () => now });
  return { rl, advance: (ms: number) => { now += ms; } };
}

describe("a normal player never meets it", () => {
  it("allows a full burst from rest", () => {
    // Someone reads a room for ten seconds then fires four commands. A
    // limiter tuned to the average would refuse exactly that, and it would
    // read as lag rather than as a rule.
    const { rl } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) {
      expect(rl.take().allowed).toBe(true);
    }
  });

  it("sustains the advertised rate indefinitely", () => {
    const { rl, advance } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl.take();
    for (let i = 0; i < 50; i += 1) {
      advance(1000 / COMMANDS_PER_SECOND);
      expect(rl.take().allowed).toBe(true);
    }
  });
});

describe("a client that will not stop", () => {
  it("is refused once the bucket is empty", () => {
    const { rl } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl.take();
    expect(rl.take().allowed).toBe(false);
  });

  it("gets a retry time it can actually obey", () => {
    // Rounded UP and never zero. Telling a client to retry in 0 seconds
    // when it cannot is how a limiter turns into a hot loop — the opposite
    // of what it is for.
    const { rl } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl.take();
    const refused = rl.take();
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const { rl: rl2, advance } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl2.take();
    advance(refused.retryAfterSeconds * 1000);
    expect(rl2.take().allowed).toBe(true);
  });

  it("does not let a hammering client bank credit", () => {
    // The failure a naive implementation has: refusals that still count
    // down, so a client spamming during its cooldown comes out ahead.
    const { rl, advance } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl.take();
    for (let i = 0; i < 500; i += 1) rl.take();
    advance(1000);
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) if (rl.take().allowed) allowed += 1;
    expect(allowed).toBeLessThanOrEqual(COMMANDS_PER_SECOND + 1);
  });

  it("refills continuously rather than in windows", () => {
    // A fixed window lets a client spend its whole allowance in the last
    // millisecond of one and again in the first of the next — double the
    // intended rate, at the worst possible moment.
    const { rl, advance } = limiter();
    for (let i = 0; i < BURST_CAPACITY; i += 1) rl.take();
    advance(500);
    const half = Math.floor(COMMANDS_PER_SECOND / 2);
    for (let i = 0; i < half; i += 1) expect(rl.take().allowed).toBe(true);
  });

  it("never accumulates beyond the burst, however long it idles", () => {
    // Otherwise an hour of silence buys an hour's worth of commands at once,
    // which is precisely the flood the limit exists to prevent.
    const { rl, advance } = limiter();
    advance(60 * 60 * 1000);
    let allowed = 0;
    for (let i = 0; i < BURST_CAPACITY * 5; i += 1) if (rl.take().allowed) allowed += 1;
    expect(allowed).toBe(BURST_CAPACITY);
  });
});

describe("what it tells the client", () => {
  it("states the rate, so an author can fix their script", () => {
    const msg = throttleMessage(3);
    expect(msg).toContain(String(COMMANDS_PER_SECOND));
    expect(msg).toContain("3 seconds");
  });

  it("says '1 second', not '1 seconds'", () => {
    expect(throttleMessage(1)).toContain("1 second.");
  });
});
