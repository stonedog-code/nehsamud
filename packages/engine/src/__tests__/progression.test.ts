import {
  HP_PER_LEVEL,
  MAX_LEVEL,
  awardExperience,
  levelForXp,
  levelProgress,
  xpForLevel,
  xpToNextLevel,
} from "../progression.js";

/**
 * The curve's exact numbers are a balance decision still open (PRD-0001 OQ4),
 * so these tests deliberately assert its PROPERTIES rather than pinning
 * values. A test that hardcoded "level 7 is 8,100 XP" would have to be
 * rewritten every time the curve is tuned, which trains people to edit tests
 * to match code — the opposite of what they are for.
 *
 * What must hold whatever the constants become: the curve is monotonic, the
 * inverse agrees with it at every boundary, and 100 is reachable and final.
 */

describe("xpForLevel", () => {
  it("starts a new character at zero", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-5)).toBe(0);
  });

  it("increases strictly with every level", () => {
    for (let l = 2; l <= MAX_LEVEL; l += 1) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    }
  });

  it("clamps above the cap rather than extrapolating", () => {
    // Otherwise a caller computing "XP to level 101" gets a real number and
    // concludes a capped character still owes something.
    expect(xpForLevel(MAX_LEVEL + 1)).toBe(xpForLevel(MAX_LEVEL));
    expect(xpForLevel(10_000)).toBe(xpForLevel(MAX_LEVEL));
  });
});

describe("levelForXp inverts the curve exactly", () => {
  it("agrees with xpForLevel at every single boundary", () => {
    // The case a player notices: standing exactly on a threshold. Rounding in
    // xpForLevel means the analytic inverse can land either side of it.
    for (let l = 1; l <= MAX_LEVEL; l += 1) {
      const at = xpForLevel(l);
      expect(levelForXp(at)).toBe(l);
      if (l > 1) expect(levelForXp(at - 1)).toBe(l - 1);
    }
  });

  it("never exceeds the cap, however much XP is thrown at it", () => {
    expect(levelForXp(xpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
    expect(levelForXp(xpForLevel(MAX_LEVEL) * 1000)).toBe(MAX_LEVEL);
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  it("treats absent or nonsense experience as level 1", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-100)).toBe(1);
    expect(levelForXp(NaN)).toBe(1);
    // Infinity is corrupt data, not an enormous score. It floors to 1 rather
    // than capping to 100 deliberately: a garbled row should not hand someone
    // the maximum level, and failing low is recoverable in a way that
    // silently granting level 100 is not.
    expect(levelForXp(Infinity)).toBe(1);
  });

  it("is monotonic across a dense sample", () => {
    let previous = 1;
    for (let xp = 0; xp <= xpForLevel(MAX_LEVEL); xp += 9_973) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe("xpToNextLevel", () => {
  it("reports the remaining gap", () => {
    const atSeven = xpForLevel(7);
    expect(xpToNextLevel(atSeven)).toBe(xpForLevel(8) - atSeven);
  });

  it("is zero at the cap, not negative", () => {
    // So a status line can render it without special-casing.
    expect(xpToNextLevel(xpForLevel(MAX_LEVEL))).toBe(0);
    expect(xpToNextLevel(xpForLevel(MAX_LEVEL) + 50_000)).toBe(0);
  });
});

describe("levelProgress", () => {
  it("is 0 at a level boundary and approaches 1 before the next", () => {
    expect(levelProgress(xpForLevel(5))).toBe(0);
    expect(levelProgress(xpForLevel(6) - 1)).toBeGreaterThan(0.9);
  });

  it("is 1 at the cap", () => {
    expect(levelProgress(xpForLevel(MAX_LEVEL))).toBe(1);
  });

  it("stays within 0..1 across the whole curve", () => {
    for (let xp = 0; xp <= xpForLevel(MAX_LEVEL); xp += 50_021) {
      const p = levelProgress(xp);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("awardExperience", () => {
  it("adds experience and reports no level-up when none was crossed", () => {
    const r = awardExperience(0, 10);
    expect(r.experience).toBe(10);
    expect(r.leveledUp).toBe(false);
    expect(r.levelsGained).toBe(0);
    expect(r.maxHpGained).toBe(0);
  });

  it("reports a level-up and its gains", () => {
    const r = awardExperience(xpForLevel(2) - 1, 1);
    expect(r.previousLevel).toBe(1);
    expect(r.level).toBe(2);
    expect(r.leveledUp).toBe(true);
    expect(r.levelsGained).toBe(1);
    expect(r.maxHpGained).toBe(HP_PER_LEVEL);
  });

  it("accumulates gains across MULTIPLE levels from one award", () => {
    // A single large award — a high-value kill at low level, or a future
    // quest reward — must not grant one level's worth of HP for four levels.
    const r = awardExperience(0, xpForLevel(5));
    expect(r.level).toBe(5);
    expect(r.levelsGained).toBe(4);
    expect(r.maxHpGained).toBe(4 * HP_PER_LEVEL);
  });

  it("refuses negative awards rather than silently subtracting", () => {
    const r = awardExperience(500, -400);
    expect(r.experience).toBe(500);
    expect(r.leveledUp).toBe(false);
  });

  it("tolerates a corrupt starting value", () => {
    expect(awardExperience(NaN, 100).experience).toBe(100);
    expect(awardExperience(-50, 100).experience).toBe(100);
    expect(awardExperience(100, NaN).experience).toBe(100);
  });

  it("stops granting levels at the cap", () => {
    const capped = xpForLevel(MAX_LEVEL);
    const r = awardExperience(capped, 1_000_000);
    expect(r.level).toBe(MAX_LEVEL);
    expect(r.leveledUp).toBe(false);
    expect(r.maxHpGained).toBe(0);
  });

  it("can carry a character from 1 to 100 by repeated award", () => {
    // The product's actual goal, exercised end to end rather than asserted
    // about. Awards are chunky on purpose — a per-kill loop would take
    // hundreds of thousands of iterations at the current curve.
    let xp = 0;
    let level = 1;
    let maxHp = 30;
    let guard = 0;
    while (level < MAX_LEVEL) {
      const r = awardExperience(xp, Math.max(100, Math.floor(xp * 0.25)));
      xp = r.experience;
      level = r.level;
      maxHp += r.maxHpGained;
      guard += 1;
      expect(guard).toBeLessThan(10_000);
    }
    expect(level).toBe(MAX_LEVEL);
    expect(maxHp).toBe(30 + (MAX_LEVEL - 1) * HP_PER_LEVEL);
  });
});
