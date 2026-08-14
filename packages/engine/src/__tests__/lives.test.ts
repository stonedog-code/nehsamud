/**
 * Nine lives, then start over (NEH-664, NEH-697).
 *
 * The rule that decides whether dying means anything. Two things matter most
 * and neither is the happy path: that the NINTH death behaves differently
 * from the first eight, and that an ordinary death costs a life and nothing
 * else — charging experience every time would make the ninth unremarkable by
 * comparison.
 */

import {
  REBIRTH_EXPERIENCE_RETAINED,
  STARTING_LIVES,
  applyDeath,
  levelForXp,
  xpForLevel,
} from "../progression.js";

const alive = (over: Partial<Parameters<typeof applyDeath>[0]> = {}) => ({
  lives: STARTING_LIVES,
  experience: 0,
  rebirths: 0,
  ...over,
});

describe("an ordinary death", () => {
  it("costs exactly one life", () => {
    expect(applyDeath(alive()).lives).toBe(STARTING_LIVES - 1);
  });

  it("costs no experience at all", () => {
    // Deliberate. The life IS the cost; charging twice would make the ninth
    // death — the one that actually resets you — feel like more of the same.
    const out = applyDeath(alive({ experience: 50_000 }));
    expect(out.experience).toBe(50_000);
    expect(out.level).toBe(levelForXp(50_000));
    expect(out.reborn).toBe(false);
  });

  it("does not count as a rebirth", () => {
    expect(applyDeath(alive({ rebirths: 2 })).rebirths).toBe(2);
  });

  it("can be taken eight times before anything changes", () => {
    let state = alive({ experience: 10_000 });
    for (let i = 0; i < STARTING_LIVES - 1; i += 1) {
      const out = applyDeath(state);
      expect(out.reborn).toBe(false);
      expect(out.experience).toBe(10_000);
      state = { lives: out.lives, experience: out.experience, rebirths: out.rebirths };
    }
    expect(state.lives).toBe(1);
  });
});

describe("the ninth death", () => {
  it("starts the character over rather than ending it", () => {
    // Not permadeath. The character survives as itself — the loss is
    // progress, not existence.
    const out = applyDeath(alive({ lives: 1, experience: 100_000 }));
    expect(out.reborn).toBe(true);
    expect(out.lives).toBe(STARTING_LIVES);
    expect(out.rebirths).toBe(1);
  });

  it("keeps 30% of accumulated experience", () => {
    const out = applyDeath(alive({ lives: 1, experience: 100_000 }));
    expect(out.experience).toBe(30_000);
    expect(REBIRTH_EXPERIENCE_RETAINED).toBe(0.3);
  });

  it("rounds the retained experience DOWN, never up", () => {
    // A point of generosity here is a point the player did not earn, and
    // rounding is the kind of thing that differs between two places later.
    expect(applyDeath(alive({ lives: 1, experience: 11 })).experience).toBe(3);
  });

  it("sets the level to whatever that experience actually implies", () => {
    // The level is derived, never carried over — a reborn character at its
    // old level with a third of the experience would out-level the curve.
    const out = applyDeath(alive({ lives: 1, experience: xpForLevel(60) }));
    expect(out.level).toBe(levelForXp(out.experience));
    expect(out.level).toBeLessThan(60);
    expect(out.level).toBeGreaterThan(1);
  });

  it("costs a high-level character real progress, not a token", () => {
    // The number that decides whether the mechanic bites. Losing 70% of the
    // curve at level 60 is roughly twenty levels.
    const before = 60;
    const out = applyDeath(alive({ lives: 1, experience: xpForLevel(before) }));
    expect(before - out.level).toBeGreaterThan(10);
  });

  it("leaves a level-1 character at level 1 rather than below it", () => {
    const out = applyDeath(alive({ lives: 1, experience: 0 }));
    expect(out.experience).toBe(0);
    expect(out.level).toBe(1);
  });

  it("accumulates rebirths across several lifetimes", () => {
    let state = alive({ lives: 1, experience: 1_000_000, rebirths: 2 });
    const first = applyDeath(state);
    expect(first.rebirths).toBe(3);
    state = { lives: 1, experience: first.experience, rebirths: first.rebirths };
    expect(applyDeath(state).rebirths).toBe(4);
  });

  it("converges toward the floor rather than to nothing", () => {
    // Repeated rebirth should not be a trap that zeroes a veteran: 30% of a
    // large number is still a large number for several rounds.
    let state = alive({ lives: 1, experience: xpForLevel(100) });
    for (let i = 0; i < 3; i += 1) {
      const out = applyDeath(state);
      state = { lives: 1, experience: out.experience, rebirths: out.rebirths };
    }
    expect(state.experience).toBeGreaterThan(0);
  });
});
