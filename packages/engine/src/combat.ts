/**
 * Combat resolution.
 *
 * Pure and deterministic: every roll comes from an injected RNG, so a test
 * can pin an exact sequence and a bug is reproducible from its seed rather
 * than "sometimes". Nothing here reads a session, a world or a database —
 * combatants are described by plain numbers, which is what lets the same
 * resolver serve a player swinging at a hostile and (later) a player swinging
 * at another player.
 *
 * It replaces a placeholder where both sides dealt a constant, so the outcome
 * of a fight was fully determined the moment it started.
 *
 * **Stats arrive as inputs, deliberately.** Where a player's damage bonus
 * comes from — race, class, equipment, level — is a separate question
 * (NEH-621 is still open, and character options are being reshaped by
 * PRD-0002). Taking them as parameters means this file does not have to
 * change when that answer arrives.
 */

/** Source of randomness. Returns a float in [0, 1). */
export interface Rng {
  next(): number;
}

/**
 * Small deterministic PRNG (mulberry32).
 *
 * Chosen for being ~6 lines, dependency-free and stable across Node versions.
 * `Math.random()` is not usable here: it cannot be seeded, so a failing fight
 * could never be replayed. Not cryptographic, and nothing here needs it to
 * be — but do not reach for this if something ever does.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** What a weapon contributes. Absent means unarmed. */
export interface Weapon {
  readonly name: string;
  /** Added to base damage before variance. */
  readonly damage: number;
  /** Added to the attacker's chance to land a blow, as a fraction. */
  readonly accuracy?: number;
}

/** What one worn piece contributes. */
export interface Armour {
  readonly name: string;
  /** Flat reduction applied after the damage roll. */
  readonly protection: number;
  /** Added to the defender's chance to avoid a blow, as a fraction. */
  readonly evasion?: number;
}

export interface Combatant {
  readonly name: string;
  readonly level: number;
  /** Damage before weapon, variance and level scaling. */
  readonly baseDamage: number;
  readonly weapon?: Weapon;
  /**
   * Every piece worn. Empty or absent means unarmoured.
   *
   * A LIST rather than one piece, since NEH-658. It was a single `Armour`,
   * which matched an `equip` that allowed one item per item TYPE — and
   * because all armour shares one type, a helmet and a shield could not
   * both be worn. Both halves had to change together: a slot column alone
   * would have let five pieces be equipped while this still read one,
   * producing a sheet that lists four pieces and applies the protection of
   * one.
   */
  readonly armour?: readonly Armour[];
  /** Extra hit chance from whatever the host derives it from. */
  readonly accuracyBonus?: number;
  /** Extra avoidance from whatever the host derives it from. */
  readonly evasionBonus?: number;
}

export interface AttackOutcome {
  readonly hit: boolean;
  readonly critical: boolean;
  /** Damage actually dealt, after armour. Never negative. */
  readonly damage: number;
  /** Damage before armour — useful for "your armour absorbed 3" messaging. */
  readonly rawDamage: number;
  readonly absorbed: number;
}

/* ── Tuning ───────────────────────────────────────────────────────
 *
 * Balance values, not laws. They are exported so tests can reason about them
 * without duplicating literals, and so a future balance pass has one place to
 * edit. Like the XP curve, these are a starting point — PRD-0001 OQ4's
 * question about pacing applies here too.
 */

/** Chance to land a blow before any modifier. */
export const BASE_HIT_CHANCE = 0.85;
/** Floor and ceiling, so no build is ever unhittable or auto-miss. */
export const MIN_HIT_CHANCE = 0.05;
export const MAX_HIT_CHANCE = 0.99;
/** Chance a landed blow is a critical. */
export const CRIT_CHANCE = 0.08;
export const CRIT_MULTIPLIER = 2;
/** Damage varies +/- this fraction of the pre-variance total. */
export const DAMAGE_VARIANCE = 0.25;
/** Damage added per level of the attacker. */
export const DAMAGE_PER_LEVEL = 0.5;
/** A landed blow always does at least this much, armour notwithstanding. */
export const MIN_DAMAGE_ON_HIT = 1;

/**
 * The most of a blow armour may absorb, as a fraction.
 *
 * THE BALANCE HALF OF NEH-658, and the reason that issue insisted the two
 * changes ship together. Once protection SUMS across worn pieces, a full
 * set is 2+3+7 = 12 or more, against low-level attackers who hit for 2-5.
 * With only the flat `MIN_DAMAGE_ON_HIT` floor, every one of those blows
 * lands for exactly 1 and an armoured level-1 character is effectively
 * immune to the entire starting area — durable is the goal, invulnerable is
 * a broken game.
 *
 * So a fraction of every blow always gets through. It scales the right way
 * on its own: a heavy hit still hurts through good armour, while armour
 * keeps mattering because it is subtracted first and only this bounds it.
 *
 * 0.75 leaves a quarter of the swing coming through at worst. An unarmoured
 * defender is completely unaffected by this — with no protection the
 * subtraction never reaches the bound — so nothing about existing
 * unarmoured combat changes.
 */
export const MAX_ARMOUR_ABSORB = 0.75;

/** Protection summed across worn pieces. */
export function totalProtection(armour: readonly Armour[] | undefined): number {
  return (armour ?? []).reduce((sum, piece) => sum + piece.protection, 0);
}

/** Evasion summed across worn pieces. */
export function totalEvasion(armour: readonly Armour[] | undefined): number {
  return (armour ?? []).reduce((sum, piece) => sum + (piece.evasion ?? 0), 0);
}

/**
 * Chance `attacker` lands a blow on `defender`.
 *
 * Clamped at both ends. Without the floor, enough evasion makes a defender
 * literally unhittable and a fight cannot end; without the ceiling, a player
 * who out-levels the content stops experiencing combat as a risk at all.
 */
export function hitChance(attacker: Combatant, defender: Combatant): number {
  const accuracy =
    BASE_HIT_CHANCE +
    (attacker.accuracyBonus ?? 0) +
    (attacker.weapon?.accuracy ?? 0);
  const evasion =
    (defender.evasionBonus ?? 0) + totalEvasion(defender.armour);
  return Math.min(MAX_HIT_CHANCE, Math.max(MIN_HIT_CHANCE, accuracy - evasion));
}

/**
 * Resolve one swing.
 *
 * Rolls are drawn in a fixed order — hit, then crit, then variance — and that
 * order is part of the contract. Changing it renumbers every seeded test, so
 * if a roll is ever added it goes on the end.
 */
export function resolveAttack(
  attacker: Combatant,
  defender: Combatant,
  rng: Rng,
): AttackOutcome {
  if (rng.next() > hitChance(attacker, defender)) {
    return {
      hit: false,
      critical: false,
      damage: 0,
      rawDamage: 0,
      absorbed: 0,
    };
  }

  const critical = rng.next() < CRIT_CHANCE;

  const base =
    attacker.baseDamage +
    (attacker.weapon?.damage ?? 0) +
    Math.floor(attacker.level * DAMAGE_PER_LEVEL);

  // Variance spans [1 - v, 1 + v].
  const swing = 1 + (rng.next() * 2 - 1) * DAMAGE_VARIANCE;
  const rolled = Math.max(1, Math.round(base * swing));
  const rawDamage = critical ? rolled * CRIT_MULTIPLIER : rolled;

  const protection = totalProtection(defender.armour);
  // A hit always hurts, and armour can never absorb ALL of one. The flat
  // floor alone was enough while protection came from a single piece; with
  // it summed across a full set, every low-level blow would land for
  // exactly 1 and a well-equipped character would be immune to the whole
  // starting area rather than merely tough.
  const floor = Math.max(
    MIN_DAMAGE_ON_HIT,
    Math.ceil(rawDamage * (1 - MAX_ARMOUR_ABSORB)),
  );
  const damage = Math.max(floor, rawDamage - protection);

  return {
    hit: true,
    critical,
    damage,
    rawDamage,
    absorbed: rawDamage - damage,
  };
}

/**
 * Narrate an outcome.
 *
 * Here rather than in the handler so the wording is tested alongside the
 * numbers it describes. It will move into the content pack's message catalog
 * (PRD-0002 R10) — the strings are deliberately assembled in one place to
 * make that a lift rather than a hunt.
 */
export function describeAttack(
  attackerName: string,
  defenderName: string,
  outcome: AttackOutcome,
  options: { secondPerson?: boolean } = {},
): string {
  // English conjugates the second person differently — "you strike", not "you
  // strikes". Verb forms are spelled out rather than built by appending "s",
  // because that rule is wrong for exactly the verb this needs: "miss"
  // becomes "misses", not "misss". A test caught it.
  //
  // Written as pairs because a content pack's message catalog (PRD-0002 R10)
  // will need both forms from a pack author anyway, and a suffix rule is not
  // something an author can be asked to reason about.
  const second = options.secondPerson === true;
  const swing = second ? "swing" : "swings";
  const miss = second ? "miss" : "misses";
  const strike = second ? "strike" : "strikes";
  const land = second ? "land" : "lands";

  if (!outcome.hit) {
    return `${attackerName} ${swing} at ${defenderName} and ${miss}.`;
  }
  const blow = outcome.critical
    ? `${attackerName} ${land} a savage blow on ${defenderName}`
    : `${attackerName} ${strike} ${defenderName}`;
  const absorbed =
    outcome.absorbed > 0 ? ` (${outcome.absorbed} absorbed)` : "";
  return `${blow} for ${outcome.damage} damage${absorbed}.`;
}
