/**
 * Turning a set of character-creation choices into a character.
 *
 * Until this module existed, the option tables carried seven modifier
 * columns each, seeded with real numbers, that nothing ever read.
 * `createPlayer` wrote no attributes at all — so every player took the
 * schema's defaults and had 10 in all seven, whoever they picked — and
 * `SessionRegistry.open()` hard-coded 30 HP with a comment promising this
 * derivation "in Phase 7". A Dwarf Warrior and a Halfling Mage were the same
 * character.
 *
 * That is the worst version of a choice: prominent, previewed, and cosmetic.
 * It implies a depth that is not there.
 *
 * DERIVATION TAKES A LIST, NOT TWO ARGUMENTS. It used to take a race and a
 * class, which is the same assumption the two hardcoded tables made: that
 * every world builds a character from exactly those two axes. A pack now
 * declares its own, so this sums however many it declares — including none,
 * which yields a character of straight base attributes rather than an error.
 *
 * ONE SOURCE OF TRUTH, DELIBERATELY. The web app previews these numbers on
 * the creation screen before any of it reaches a database, so it needs the
 * same arithmetic. It imports THIS module rather than keeping its own table —
 * the app used to have an independent hp/damage table with different values,
 * which meant the preview promised numbers the engine would never produce.
 */

/** The seven attributes, as modifiers one chosen option contributes. */
export interface AttributeMods {
  strengthMod: number;
  intelligenceMod: number;
  wisdomMod: number;
  charismaMod: number;
  constitutionMod: number;
  dexterityMod: number;
  luckMod: number;
}

/** The seven attributes, as a character actually has them. */
export interface Attributes {
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
}

/**
 * Where every attribute starts before race and class.
 *
 * 10 matches the schema default, so a row written before this derivation
 * existed reads as an unmodified human rather than as a broken character.
 */
export const BASE_ATTRIBUTE = 10;

/** No attribute drops below this, however unlucky the combination. */
export const MIN_ATTRIBUTE = 1;

/**
 * Base plus every chosen option's modifiers, floored.
 *
 * Order does not matter — addition — so a pack may declare its axes in any
 * sequence and reorder them later without changing anybody's character.
 */
export function deriveAttributes(chosen: readonly AttributeMods[]): Attributes {
  const total = (pick: (m: AttributeMods) => number): number =>
    Math.max(
      MIN_ATTRIBUTE,
      chosen.reduce((sum, mods) => sum + pick(mods), BASE_ATTRIBUTE),
    );
  return {
    strength: total((m) => m.strengthMod),
    intelligence: total((m) => m.intelligenceMod),
    wisdom: total((m) => m.wisdomMod),
    charisma: total((m) => m.charismaMod),
    constitution: total((m) => m.constitutionMod),
    dexterity: total((m) => m.dexterityMod),
    luck: total((m) => m.luckMod),
  };
}

/* ── Health ───────────────────────────────────────────────────── */

/** Health a character of no particular constitution has at level 1. */
export const BASE_MAX_HP = 30;

/** Health per point of constitution above `BASE_ATTRIBUTE`. */
export const HP_PER_CONSTITUTION = 2;

/**
 * Health gained per level, before constitution.
 *
 * Matches `HP_PER_LEVEL` in progression.ts, which is where levelling reads
 * it. Constitution then scales the per-level gain too — otherwise a
 * constitution advantage is a fixed 8 HP that matters at level 1 and is
 * noise by level 100.
 */
export const HP_PER_LEVEL = 5;

/** Extra health per level, per point of constitution above the baseline. */
export const HP_PER_LEVEL_PER_CONSTITUTION = 0.5;

/** Nobody has less than this, whatever the arithmetic says. */
export const MIN_MAX_HP = 1;

/**
 * Maximum health for a character at a level, given their constitution.
 *
 * Level 1 returns the starting pool, so `createPlayer` and a level-up read
 * the same function rather than one adding to what the other set — an
 * increment and a recomputation drift the moment either changes.
 */
export function maxHpForLevel(level: number, constitution: number): number {
  const conMod = constitution - BASE_ATTRIBUTE;
  const levels = Math.max(0, level - 1);
  const total =
    BASE_MAX_HP +
    conMod * HP_PER_CONSTITUTION +
    levels * (HP_PER_LEVEL + conMod * HP_PER_LEVEL_PER_CONSTITUTION);
  return Math.max(MIN_MAX_HP, Math.floor(total));
}

/* ── Damage ───────────────────────────────────────────────────── */

/** Unarmed damage for a character of no particular strength. */
export const BASE_PLAYER_DAMAGE = 5;

/** Damage per point of strength above `BASE_ATTRIBUTE`. */
export const DAMAGE_PER_STRENGTH = 0.5;

/** A swing always threatens at least this much. */
export const MIN_PLAYER_DAMAGE = 1;

/**
 * Base damage before weapon, level scaling and variance.
 *
 * Deliberately a *small* slope. Strength ranges roughly 6–15 here, so this
 * spans about 3–8 — enough that a strong build visibly out-hits a frail one,
 * without making the weapon in your hand irrelevant. Equipment should stay
 * the bigger lever; a build that wins unarmed makes `equip` pointless.
 */
export function baseDamageFor(strength: number): number {
  const raw =
    BASE_PLAYER_DAMAGE + (strength - BASE_ATTRIBUTE) * DAMAGE_PER_STRENGTH;
  return Math.max(MIN_PLAYER_DAMAGE, Math.floor(raw));
}

/* ── The whole character, for a preview ───────────────────────── */

export interface DerivedCharacter {
  attributes: Attributes;
  maxHp: number;
  baseDamage: number;
}

/**
 * Everything a creation screen wants to show, from the chosen rows.
 *
 * Level 1, because that is what is being created. A caller wanting the
 * numbers at another level uses `maxHpForLevel` directly.
 */
export function deriveCharacter(
  chosen: readonly AttributeMods[],
): DerivedCharacter {
  const attributes = deriveAttributes(chosen);
  return {
    attributes,
    maxHp: maxHpForLevel(1, attributes.constitution),
    baseDamage: baseDamageFor(attributes.strength),
  };
}
