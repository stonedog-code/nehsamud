/**
 * Type shapes shared across the fixture catalog.
 *
 * Stable string keys (group.key, option.slug, room.enumKey, item.name,
 * hostile.slug, npc.slug) are the application-layer references.
 * Don't rename them without a paired application-side change.
 */

/**
 * One choice on one character-creation axis — "Elf", "Warrior",
 * "Night nurse".
 *
 * Its `slug` is unique within its group rather than globally, so two
 * groups may both offer a "standard" without colliding.
 */
export interface CharacterOptionFixture {
  slug: string;
  name: string;
  description: string;
  strengthMod: number;
  intelligenceMod: number;
  wisdomMod: number;
  charismaMod: number;
  constitutionMod: number;
  dexterityMod: number;
  luckMod: number;
  abilities: string[];
  directives: string[];
  baseExperienceAdjustment: number;
  /** Defaults to true. False hides the option from creation. */
  selectable?: boolean;
}

/**
 * An axis a character is built on, declared by the content pack.
 *
 * This is the thing that used to be hardcoded. The engine had a `race`
 * table and a `class` table, so every world had exactly those two axes and
 * could have no others — a care-centre world would have had to explain what
 * a resident's "race" and "class" were. A pack now declares its own: this
 * one has Race and Class because it is a fantasy pack.
 */
export interface CharacterOptionGroupFixture {
  /** Stable lowercase key, e.g. "race". The wire value. */
  key: string;
  /** What a player is shown, e.g. "Race". */
  name: string;
  description: string;
  /** Order the creation flow asks in. Ties broken by `key`. */
  position: number;
  /** Whether a character must pick from this group. Defaults to true. */
  required?: boolean;
  options: CharacterOptionFixture[];
}

export interface RoomFixture {
  enumKey: string;
  name: string;
  description: string;
  /**
   * Per-room art / atmosphere hint. Distinct from `area`: two rooms in one
   * area can look nothing alike, and this drives room-art generation.
   * `environment` used to be the ONLY grouping, doing this job and the
   * region's at once — which worked while there was exactly one region.
   */
  environment: string | null;
  /** `AreaFixture.key` this room belongs to. */
  area: string;
  /** Exits map: direction → roomEnumKey. Resolved to UUIDs at seed
   * time once every room row exists. */
  exits: Record<string, string>;
}

/**
 * Matches the MudItem.type IntEnum mirrored in hopper-play:
 *   1 = weapon, 2 = armor, 3 = consumable (food + potion),
 *   4 = lightsource, 5 = misc.
 */
export type ItemType = 1 | 2 | 3 | 4 | 5;

export interface ItemFixture {
  name: string;
  description: string;
  type: ItemType;
  /** For weapons: base damage. For armor: damage reduction. For
   * lightsources: burn duration in minutes. Null for consumables
   * and misc. */
  baseValue: number | null;
  weight: number;
}

/** Something that can be fought. */
export interface HostileFixture {
  slug: string;
  name: string;
  description: string;
  level: number;
  baseHp: number;
  baseDamage: number;
  experience: number;
  /**
   * Pack-defined labels, e.g. `["undead", "evil"]`.
   *
   * Replaced an `alignment` enum of four moral positions and a `mobType`
   * enum of five creature kinds — a fantasy bestiary's taxonomy, which every
   * world had to have whether or not it had a bestiary. The engine reads
   * none of these; they exist so a pack can classify its own content.
   */
  tags: string[];
}

export interface NpcFixture {
  slug: string;
  name: string;
  description: string;
  /** Resolves to roomId at seed time; null when the NPC isn't
   * placed yet. */
  roomEnumKey: string | null;
  pronoun: "he" | "she" | "they";
  /** Pack-defined labels, same as {@link HostileFixture.tags}. */
  tags: string[];
  intelligenceMode: "canned" | "ai";
  dialogLines: string[];
  interests: string[];
}

/**
 * Status effect catalog. TS-only (not persisted) — the Phase 5
 * combat system applies these at runtime to a per-fight buff/debuff
 * list. Promoted to a DB model if we ever need cross-restart
 * effect persistence; for now combat state lives in memory.
 */
export interface EffectFixture {
  slug: string;
  name: string;
  description: string;
  /** Combat side-effect category. */
  category: "buff" | "debuff" | "dot" | "hot" | "control";
  /** Number of combat rounds the effect persists. -1 = until
   * dispelled or end of combat. */
  durationRounds: number;
  /** Per-round value (damage for dot, healing for hot, stat
   * modifier for buff/debuff). Null when the effect is binary
   * (e.g. "stunned" — present or absent). */
  perRoundValue: number | null;
}
