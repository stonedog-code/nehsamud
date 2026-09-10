/**
 * Townsmee — the fantasy pack, and the first one.
 *
 * PRD-0002 phase 1: "Townsmee moves into a pack unchanged." Unchanged is
 * meant literally — this file adds no content and edits none. It assembles
 * the modules under `seed/fixtures/` into the {@link ContentPack} shape the
 * seeder and the boot now take, and names the spawn point that used to be a
 * string literal in three separate files (`ws-server.ts`, `look.ts` and
 * `seed/seed.ts`, each with its own copy and no mechanism keeping them in
 * step).
 *
 * WHY THE FIXTURES STAY WHERE THEY ARE. PRD-0002 §5 sketches a separate
 * `packages/content-townsmee` workspace, and that is still the right end
 * state. It is not this change: moving them is a packaging decision tangled
 * with OQ1 (whether a host's pack lives in the host's repo, which makes the
 * pack contract a published API) and it would touch the Dockerfile, the
 * `@nehsamud/engine/catalog` subpath `apps/web` imports, and CI. The
 * contract is what unblocks a second world, and the contract is here.
 *
 * So the engine still BUNDLES a world, but no longer ASSUMES one: every
 * consumer takes a pack as an argument, and this one is merely the pack the
 * standalone deployment passes.
 */

import {
  AREAS,
  CHARACTER_OPTION_GROUPS,
  EFFECTS,
  HOSTILES,
  HOSTILE_SPAWNS,
  ITEMS,
  ITEM_PLACEMENTS,
  NPCS,
  ROOMS,
} from "../seed/fixtures/index.js";
import type { ContentPack } from "./pack.js";

export const TOWNSMEE_PACK: ContentPack = {
  key: "townsmee",
  name: "Townsmee",
  spawnRoomEnumKey: "TOWNSMEE_TOWNSQUARE",
  areas: AREAS,
  rooms: ROOMS,
  items: ITEMS,
  hostiles: HOSTILES,
  npcs: NPCS,
  effects: EFFECTS,
  characterOptionGroups: CHARACTER_OPTION_GROUPS,
  itemPlacements: ITEM_PLACEMENTS,
  hostileSpawns: HOSTILE_SPAWNS,
};
