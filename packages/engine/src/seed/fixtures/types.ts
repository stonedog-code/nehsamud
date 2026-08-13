/**
 * Type shapes shared across the fixture catalog.
 *
 * Stable string keys (race.slug, room.enumKey, item.name,
 * monster.slug, npc.slug) are the application-layer references.
 * Don't rename them without a paired application-side change.
 */

export interface RaceFixture {
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
}

export interface ClassFixture {
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

export interface MonsterFixture {
  slug: string;
  name: string;
  description: string;
  level: number;
  baseHp: number;
  baseDamage: number;
  experience: number;
  alignment: Alignment;
  mobType: MobType;
}

export interface NpcFixture {
  slug: string;
  name: string;
  description: string;
  /** Resolves to roomId at seed time; null when the NPC isn't
   * placed yet. */
  roomEnumKey: string | null;
  pronoun: "he" | "she" | "they";
  alignment: Alignment;
  intelligenceMode: "canned" | "ai";
  dialogLines: string[];
  interests: string[];
}

export type Alignment = "lawful_good" | "good" | "neutral" | "evil";
export type MobType = "humanoid" | "beast" | "undead" | "elemental" | "construct";

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
