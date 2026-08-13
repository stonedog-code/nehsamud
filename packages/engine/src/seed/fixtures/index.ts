/**
 * Barrel for the per-category fixture catalogs. Importers depend
 * on stable named exports from this module rather than reaching
 * directly into the per-category files, so the catalog can be
 * reorganized later without callsite churn.
 */

export { RACES } from "./races.js";
export { CLASSES } from "./classes.js";
export { ROOMS } from "./rooms.js";
export { ITEMS } from "./items.js";
export { MONSTERS } from "./monsters.js";
export { NPCS } from "./npcs.js";
export { EFFECTS } from "./effects.js";
export {
  ITEM_PLACEMENTS,
  MONSTER_SPAWNS,
  type ItemPlacementFixture,
  type MonsterSpawnFixture,
} from "./spawns.js";

export type {
  Alignment,
  ClassFixture,
  EffectFixture,
  ItemFixture,
  ItemType,
  MobType,
  MonsterFixture,
  NpcFixture,
  RaceFixture,
  RoomFixture,
} from "./types.js";
