/**
 * Experience and levelling.
 *
 * The product's stated goal is that a character gains experience and reaches
 * level 100. Everything here is pure arithmetic over a total-XP number — no
 * database, no session — so the curve can be reasoned about and tested on its
 * own, and so a level is always *derived* rather than stored as a second
 * source of truth that can disagree with the experience beside it.
 *
 * That derivation matters more than it looks. `mud.player` carries both
 * `level` and `experience` columns; if levelling incremented the column
 * directly, a lost write or a hand-edited row would leave the two
 * contradicting each other with no way to tell which was right. Deriving
 * level from XP means the column is a cache, and a wrong one is
 * self-correcting on the next load.
 */

import { BASE_ATTRIBUTE, maxHpForLevel } from "./character.js";
export { HP_PER_LEVEL } from "./character.js";

/** Nobody advances past this. The brief's target. */
export const MAX_LEVEL = 100;

/**
 * Curve shape: cumulative XP to *reach* level n is `BASE * (n-1) ** EXPONENT`.
 *
 * Chosen to be smooth, strictly increasing, and cheap to invert. The values
 * are a starting point rather than a balance decision — PRD-0001 OQ4 ("what
 * total playtime is level 100 meant to represent?") is still open, and
 * tuning these two constants is how that question gets answered once there
 * is a real world to measure against.
 *
 * With the current numbers: level 2 at 100 XP, level 10 at ~24k, level 100
 * at ~9.75M. Against the ~20 XP a seeded hostile is worth today that is far
 * too slow at the top end — which is expected, because XP per kill is meant
 * to scale with hostile difficulty in the areas that do not exist yet
 * (NEH-626). Do not "fix" the curve by flattening it before those areas
 * land; the two are one balance problem.
 */
export const XP_CURVE_BASE = 100;
export const XP_CURVE_EXPONENT = 2.5;

/**
 * Total experience required to reach `level`.
 *
 * Level 1 is 0 — a new character starts there. Anything above MAX_LEVEL is
 * clamped, so callers cannot accidentally compute a threshold beyond the cap
 * and conclude a capped character still owes XP.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const capped = Math.min(level, MAX_LEVEL);
  return Math.round(XP_CURVE_BASE * (capped - 1) ** XP_CURVE_EXPONENT);
}

/**
 * The level a character with this much total experience has reached.
 *
 * Inverts the curve directly rather than looping, then corrects by at most
 * one step for floating-point drift at the boundaries. A loop would be fine
 * at 100 levels, but the correction is needed either way: `Math.round` in
 * `xpForLevel` means the analytic inverse can land one either side of a
 * threshold, and a character sitting exactly on a level boundary is the case
 * a player will notice.
 */
export function levelForXp(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 1;

  const raw =
    Math.floor((experience / XP_CURVE_BASE) ** (1 / XP_CURVE_EXPONENT)) + 1;
  let level = Math.min(Math.max(raw, 1), MAX_LEVEL);

  // Correct off-by-one from rounding in either direction.
  while (level < MAX_LEVEL && experience >= xpForLevel(level + 1)) level += 1;
  while (level > 1 && experience < xpForLevel(level)) level -= 1;

  return level;
}

/**
 * Experience still owed to reach the next level, or 0 at the cap.
 *
 * Returns 0 rather than a negative or a NaN at MAX_LEVEL so a status line can
 * render it without special-casing — "0 to next" reads correctly for a capped
 * character.
 */
export function xpToNextLevel(experience: number): number {
  const level = levelForXp(experience);
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, xpForLevel(level + 1) - experience);
}

/** Progress through the current level, 0–1. At the cap, 1. */
export function levelProgress(experience: number): number {
  const level = levelForXp(experience);
  if (level >= MAX_LEVEL) return 1;
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = ceiling - floor;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (experience - floor) / span));
}

/** What a level-up grants. Applied once per level crossed. */
export interface LevelGains {
  /** Added to maximum HP. */
  readonly maxHp: number;
}

/**
 * Per-level gains, for a given constitution.
 *
 * This was a flat 5, with a comment saying race and class modifiers were
 * inert engine-wide (NEH-621) and that inventing a formula here would create
 * a second place to keep in agreement. That is exactly why the gain is now a
 * DIFFERENCE of `maxHpForLevel` rather than a formula of its own: there is
 * still only one place that knows how constitution becomes health, and
 * "created at level 5" and "levelled up to 5" cannot drift apart, because
 * both resolve through the same function.
 *
 * Constitution defaults to the baseline so callers that genuinely do not
 * have a character — older tests, tooling — still get the old flat number.
 */
export function gainsForLevel(
  level: number,
  constitution: number = BASE_ATTRIBUTE,
): LevelGains {
  return {
    maxHp:
      maxHpForLevel(level, constitution) -
      maxHpForLevel(level - 1, constitution),
  };
}

export interface AwardResult {
  /** Total experience after the award. */
  readonly experience: number;
  readonly previousLevel: number;
  readonly level: number;
  /** True when at least one level was crossed. */
  readonly leveledUp: boolean;
  /** Levels crossed — more than one is possible from a single large award. */
  readonly levelsGained: number;
  /** Total max-HP granted across every level crossed. */
  readonly maxHpGained: number;
}

/**
 * Apply an experience award and report what it did.
 *
 * Pure: the caller owns the session and the database. Returning the whole
 * before/after picture rather than mutating means the announcement, the
 * stat application and the persistence all read from one consistent answer
 * instead of recomputing it three times.
 *
 * A single award can cross several levels — a high-value kill at low level,
 * or a future quest reward — so gains accumulate across every level crossed
 * rather than being applied once.
 */
export function awardExperience(
  currentExperience: number,
  amount: number,
  constitution: number = BASE_ATTRIBUTE,
): AwardResult {
  const safeCurrent = Number.isFinite(currentExperience)
    ? Math.max(0, currentExperience)
    : 0;
  // Negative awards are refused rather than applied. Nothing grants them
  // today, and silently subtracting XP is the kind of thing that should be
  // an explicit operation if it is ever wanted.
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;

  const previousLevel = levelForXp(safeCurrent);
  const experience = safeCurrent + safeAmount;
  const level = levelForXp(experience);

  let maxHpGained = 0;
  for (let l = previousLevel + 1; l <= level; l += 1) {
    maxHpGained += gainsForLevel(l, constitution).maxHp;
  }

  return {
    experience,
    previousLevel,
    level,
    leveledUp: level > previousLevel,
    levelsGained: level - previousLevel,
    maxHpGained,
  };
}

/* ── Lives and rebirth ─────────────────────────────────────────────
 *
 * The answer to "what does dying cost", which was open until now and is the
 * thing that decides whether a mode means anything (NEH-664, NEH-697).
 *
 * A character has NINE LIVES. A death spends one. At zero it is REBORN — it
 * keeps its name, keeps a fraction of its experience, and chooses its
 * creation options again.
 *
 * NOT PERMADEATH, DELIBERATELY. Deleting the character is a different
 * product, and this engine also serves an audience for whom losing
 * everything to one bad fight is the moment they stop playing. Cutting
 * experience keeps the loss real — a level 60 character comes back around
 * level 40 — while leaving something to come back to.
 *
 * REBIRTH IS ALSO THE ONLY WAY TO CHANGE BUILD. Creation options are
 * otherwise permanent, so nine lives is both the cost of dying and the
 * mechanism for becoming something else. That is why it re-asks rather than
 * silently keeping what you had.
 */

/** Lives a character starts with, and returns to after a rebirth. */
export const STARTING_LIVES = 9;

/** Fraction of accumulated experience a reborn character keeps. */
export const REBIRTH_EXPERIENCE_RETAINED = 0.3;

export interface DeathOutcome {
  /** Lives left after this death. */
  lives: number;
  /** True when this death spent the last one. */
  reborn: boolean;
  /** Experience after the death — unchanged unless reborn. */
  experience: number;
  /** Level implied by that experience. */
  level: number;
  /** Total rebirths after this death. */
  rebirths: number;
}

/**
 * Apply one death.
 *
 * Pure, and takes the whole prior state rather than mutating a session, so
 * the rule is testable without a world — and so the ws layer, the PVP path
 * and the monster path cannot each grow their own slightly different
 * version of it.
 */
export function applyDeath(prior: {
  lives: number;
  experience: number;
  rebirths: number;
}): DeathOutcome {
  const lives = prior.lives - 1;
  if (lives > 0) {
    // An ordinary death. Experience is untouched — the cost is the life,
    // and charging twice for one death would make the ninth meaningless by
    // comparison.
    return {
      lives,
      reborn: false,
      experience: prior.experience,
      level: levelForXp(prior.experience),
      rebirths: prior.rebirths,
    };
  }

  // The last life. `Math.floor` rather than round, so the retained figure is
  // never generous by a point and the arithmetic is the same in every
  // direction.
  const experience = Math.floor(prior.experience * REBIRTH_EXPERIENCE_RETAINED);
  return {
    lives: STARTING_LIVES,
    reborn: true,
    experience,
    level: levelForXp(experience),
    rebirths: prior.rebirths + 1,
  };
}
