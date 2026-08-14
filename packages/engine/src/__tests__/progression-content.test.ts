/**
 * Is there enough to fight to reach the level cap?
 *
 * NEH-664 asked for this assertion and noted that, as written then, it would
 * fail by three orders of magnitude: the world held a few thousand
 * experience in total and the curve wanted ten million, because a killed
 * hostile never came back.
 *
 * RESPAWN CHANGES THE QUESTION. With spawn points refilling, the available
 * experience is no longer a fixed pool to exhaust — it is a RATE. So "can a
 * player reach the cap" stops being "is there enough content" and becomes
 * "how long does it take", which is a design question with a number
 * attached rather than an impossibility.
 *
 * This file computes that number and pins it. It does NOT decide the cap —
 * that is a game-design call (NEH-664 step 1) and is deliberately still
 * open. What it does is make the current relationship visible in code and
 * fail loudly if a curve edit, a `MAX_LEVEL` change or a catalog change
 * moves it by an order of magnitude, so the decision is made on purpose
 * rather than discovered by a player at level 30.
 */

import { HOSTILE_SPAWNS, HOSTILES } from "../seed/fixtures/index.js";
import { MAX_LEVEL, xpForLevel } from "../progression.js";
import { RESPAWN_DELAY_MS } from "../world/world-state.js";

/** Experience from clearing every spawn point in the world once. */
function experiencePerClear(): number {
  const bySlug = new Map(HOSTILES.map((h) => [h.slug, h.experience]));
  return HOSTILE_SPAWNS.reduce(
    (total, spawn) => total + (bySlug.get(spawn.hostileSlug) ?? 0),
    0,
  );
}

/**
 * Hours of pure combat to reach the cap, at the theoretical maximum rate.
 *
 * Optimistic on purpose — it assumes a player clears every spawn point the
 * instant it refills, which nobody can do because they cannot be in
 * twenty-two rooms at once and the walking is not free. The real figure is
 * some multiple of this. A LOWER BOUND is the honest thing to assert: if
 * even the impossible-best case is unreasonable, the achievable case
 * certainly is.
 */
function bestCaseHoursToCap(): number {
  const clears = Math.ceil(xpForLevel(MAX_LEVEL) / experiencePerClear());
  return (clears * RESPAWN_DELAY_MS) / 3_600_000;
}

describe("the world can supply the curve", () => {
  it("every spawn point names a hostile that exists", () => {
    // Cheap, and it is the assumption every number below rests on: a spawn
    // for a slug the catalog dropped contributes zero experience silently.
    const slugs = new Set(HOSTILES.map((h) => h.slug));
    const orphans = HOSTILE_SPAWNS.filter((s) => !slugs.has(s.hostileSlug));
    expect(orphans).toEqual([]);
  });

  it("the cap is reachable at all, which respawn is what makes true", () => {
    // Before spawn points refilled, the entire world cleared once was worth
    // ~1,335 experience against a cap wanting ~9,750,000 — the cap was not
    // slow, it was unreachable. This asserts the fixed pool is gone.
    expect(experiencePerClear()).toBeGreaterThan(0);
    expect(Number.isFinite(bestCaseHoursToCap())).toBe(true);
  });

  it("reaching the cap is not absurd, and not trivial", () => {
    // A TRIPWIRE, NOT A TARGET. Nobody has decided that ~180 hours is the
    // right shape for this game; the band exists so that a change to
    // MAX_LEVEL, the curve exponent, the spawn list or the respawn delay
    // that moves this by an order of magnitude fails here and gets talked
    // about, instead of shipping and being found by a player at level 30.
    //
    // If this test fails, the question is which of the two numbers is
    // wrong — the curve or the content — and that is exactly the
    // conversation NEH-664 step 1 exists to have.
    const hours = bestCaseHoursToCap();
    expect(hours).toBeGreaterThan(20);
    expect(hours).toBeLessThan(500);
  });

  it("the early levels are quick enough to teach the loop", () => {
    // The part that matters most for a new player: the first few levels
    // have to arrive fast enough to show that fighting does something. This
    // one IS a design position, and a mild one — under an hour to level 10.
    const clearsToTen = xpForLevel(10) / experiencePerClear();
    const hoursToTen = (clearsToTen * RESPAWN_DELAY_MS) / 3_600_000;
    expect(hoursToTen).toBeLessThan(1);
  });

  it("the catalog spans the level bands the map advertises", () => {
    // The areas are banded 1-3, 2-5, 3-6 and 5-8. A catalog that stopped at
    // level 2 would leave the later areas nominally harder and mechanically
    // identical.
    const levels = HOSTILES.map((h) => h.level);
    expect(Math.min(...levels)).toBeLessThanOrEqual(1);
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(6);
  });
});
