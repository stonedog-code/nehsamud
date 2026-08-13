/**
 * Barrel for the per-category fixture catalogs. Importers depend
 * on stable named exports from this module rather than reaching
 * directly into the per-category files, so the catalog can be
 * reorganized later without callsite churn.
 */

export { RACES } from "./races.js";
export { CLASSES } from "./classes.js";
import { BARROWDEEP_ROOMS as BARROWDEEP_ROOMS_INTERNAL } from "./rooms-barrowdeep.js";
import { WILDS_ROOMS as WILDS_ROOMS_INTERNAL } from "./rooms-wilds.js";
import { TOWNSMEE_ROOMS as TOWNSMEE_ROOMS_INTERNAL } from "./rooms.js";
import type { RoomFixture } from "./types.js";

export { AREAS, findArea, type AreaFixture } from "./areas.js";
export { TOWNSMEE_ROOMS } from "./rooms.js";
export { WILDS_ROOMS } from "./rooms-wilds.js";
export { BARROWDEEP_ROOMS } from "./rooms-barrowdeep.js";

/**
 * The whole map, assembled from its areas.
 *
 * One file per area, joined here, rather than one 60-room file: the seed and
 * every consumer still see a single `ROOMS`, and an author editing the barrow
 * does not have to scroll past the town to find it.
 */
export const ROOMS: RoomFixture[] = [
  ...TOWNSMEE_ROOMS_INTERNAL,
  ...WILDS_ROOMS_INTERNAL,
  ...BARROWDEEP_ROOMS_INTERNAL,
];
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
