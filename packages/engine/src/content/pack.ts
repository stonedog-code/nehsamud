/**
 * A content pack — one world's nouns and prose, authored outside the engine.
 *
 * PRD-0002 draws the line this file exists to hold:
 *
 * > A pack supplies **nouns and prose**. The engine owns **verbs and rules**.
 *
 * The engine already loaded its world from Postgres, so two deployments
 * pointed at two databases already had two different worlds. What was
 * missing was a way to *author* one: Townsmee was compiled into
 * `seed/fixtures/`, and `TOWNSMEE_TOWNSQUARE` was hardcoded in three
 * separate files as the spawn point. A pack is the thing the seeder and the
 * boot now take, so a second world is data rather than a fork of the engine.
 *
 * WHAT A PACK MAY NOT DO, and why it is checked rather than documented.
 * Directions are engine-owned (R13): `north` is a mechanic, and a pack
 * renaming it would break both muscle memory and the scripting language.
 * That is easy to agree with in review and easy to lose one exit at a time,
 * so {@link validateContentPack} rejects an exit in a direction the parser
 * does not know.
 */

import { DIRECTIONS } from "../commands/parser.js";
import type { AreaFixture } from "../seed/fixtures/areas.js";
import type {
  HostileSpawnFixture,
  ItemPlacementFixture,
} from "../seed/fixtures/spawns.js";
import type {
  CharacterOptionGroupFixture,
  EffectFixture,
  HostileFixture,
  ItemFixture,
  NpcFixture,
  RoomFixture,
} from "../seed/fixtures/types.js";

/**
 * Everything one world is made of.
 *
 * Deliberately a plain data object with no engine dependency beyond these
 * types, so a host can author one without pulling in express or Prisma —
 * PRD-0002 §5. Nothing here is optional: a pack that forgets its hostiles
 * should say `hostiles: []` rather than leave the seeder to guess whether
 * the omission meant "none" or "not written yet".
 */
export interface ContentPack {
  /** Stable identifier for this world, e.g. `"townsmee"`. */
  key: string;
  /** What this world is called, in player-facing prose. */
  name: string;
  /**
   * The room a new or displaced character lands in.
   *
   * Must name a room in `rooms` — checked, because a pack naming a
   * nonexistent spawn produced a world where every character woke in a
   * "featureless void" and the transcript said `(Bug: spawn room missing.)`
   * to the player rather than to the operator.
   */
  spawnRoomEnumKey: string;
  areas: AreaFixture[];
  rooms: RoomFixture[];
  items: ItemFixture[];
  hostiles: HostileFixture[];
  npcs: NpcFixture[];
  effects: EffectFixture[];
  /** The character-creation axes this pack declares (R7/G3). */
  characterOptionGroups: CharacterOptionGroupFixture[];
  itemPlacements: ItemPlacementFixture[];
  hostileSpawns: HostileSpawnFixture[];
}

/** One thing wrong with a pack, named well enough to fix. */
export interface PackProblem {
  /** Where in the pack, e.g. `rooms[3].exits.north`. */
  at: string;
  /** What is wrong, in a sentence an author can act on. */
  message: string;
}

const DIRECTION_SET: ReadonlySet<string> = new Set(DIRECTIONS);

/** Report keys that appear more than once, in first-seen order. */
function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return [...dupes];
}

/**
 * Everything wrong with a pack, or an empty array.
 *
 * Returns ALL problems rather than throwing on the first. A pack is
 * authored content, and an author fixing one broken exit only to be told
 * about the next one is a worse experience than a list — and a boot that
 * fails five times in a row looks like five different faults.
 */
export function validateContentPack(pack: ContentPack): PackProblem[] {
  const problems: PackProblem[] = [];
  const fail = (at: string, message: string): void => {
    problems.push({ at, message });
  };

  /* ── Identity ──────────────────────────────────────────────── */

  if (!pack.key.trim()) fail("key", "a pack needs a non-empty key");
  if (!pack.name.trim()) fail("name", "a pack needs a non-empty name");

  /* ── A world with no rooms is not a world ──────────────────── */

  if (pack.rooms.length === 0) {
    fail("rooms", "a pack must declare at least one room");
  }

  /* ── Unique application-layer keys ─────────────────────────── */
  // These are the identifiers the seeder upserts by. Two rooms sharing an
  // enumKey does not fail the seed — the second silently overwrites the
  // first, and the world quietly loses a room nobody can find again.

  for (const [at, dupes] of [
    ["areas", duplicates(pack.areas.map((a) => a.key))],
    ["rooms", duplicates(pack.rooms.map((r) => r.enumKey))],
    ["items", duplicates(pack.items.map((i) => i.name))],
    ["hostiles", duplicates(pack.hostiles.map((h) => h.slug))],
    ["npcs", duplicates(pack.npcs.map((n) => n.slug))],
    ["effects", duplicates(pack.effects.map((e) => e.slug))],
    [
      "characterOptionGroups",
      duplicates(pack.characterOptionGroups.map((g) => g.key)),
    ],
  ] as const) {
    for (const key of dupes) {
      fail(at, `duplicate key ${JSON.stringify(key)}`);
    }
  }

  // Option slugs are unique WITHIN a group, not globally, so two groups may
  // both offer a "standard" without colliding — see CharacterOptionFixture.
  for (const group of pack.characterOptionGroups) {
    for (const slug of duplicates(group.options.map((o) => o.slug))) {
      fail(
        `characterOptionGroups.${group.key}`,
        `duplicate option slug ${JSON.stringify(slug)}`,
      );
    }
  }

  /* ── Every reference resolves inside this pack ─────────────── */
  // "Inside this pack" is the point. Packs are not mixed (NG3), so a
  // reference that resolves only because another pack happens to be loaded
  // is a world that breaks when it ships alone.

  const roomKeys = new Set(pack.rooms.map((r) => r.enumKey));
  const areaKeys = new Set(pack.areas.map((a) => a.key));
  const itemNames = new Set(pack.items.map((i) => i.name));
  const hostileSlugs = new Set(pack.hostiles.map((h) => h.slug));

  if (!roomKeys.has(pack.spawnRoomEnumKey)) {
    fail(
      "spawnRoomEnumKey",
      `spawn room ${JSON.stringify(pack.spawnRoomEnumKey)} is not a room in this pack`,
    );
  }

  for (const room of pack.rooms) {
    if (!areaKeys.has(room.area)) {
      fail(
        `rooms.${room.enumKey}.area`,
        `area ${JSON.stringify(room.area)} is not an area in this pack`,
      );
    }
    for (const [direction, target] of Object.entries(room.exits)) {
      // R13. A pack may not invent a direction; the parser could not route
      // it and the scripting language could not name it.
      if (!DIRECTION_SET.has(direction)) {
        fail(
          `rooms.${room.enumKey}.exits.${direction}`,
          `${JSON.stringify(direction)} is not an engine direction — ` +
            `directions are engine-owned (one of: ${DIRECTIONS.join(", ")})`,
        );
      }
      if (!roomKeys.has(target)) {
        fail(
          `rooms.${room.enumKey}.exits.${direction}`,
          `leads to ${JSON.stringify(target)}, which is not a room in this pack`,
        );
      }
    }
  }

  for (const npc of pack.npcs) {
    // null is legitimate — an NPC written but not placed yet.
    if (npc.roomEnumKey !== null && !roomKeys.has(npc.roomEnumKey)) {
      fail(
        `npcs.${npc.slug}.roomEnumKey`,
        `room ${JSON.stringify(npc.roomEnumKey)} is not a room in this pack`,
      );
    }
  }

  pack.itemPlacements.forEach((placement, i) => {
    if (!roomKeys.has(placement.roomEnumKey)) {
      fail(
        `itemPlacements[${i}].roomEnumKey`,
        `room ${JSON.stringify(placement.roomEnumKey)} is not a room in this pack`,
      );
    }
    if (!itemNames.has(placement.itemName)) {
      fail(
        `itemPlacements[${i}].itemName`,
        `item ${JSON.stringify(placement.itemName)} is not an item in this pack`,
      );
    }
  });

  pack.hostileSpawns.forEach((spawn, i) => {
    if (!roomKeys.has(spawn.roomEnumKey)) {
      fail(
        `hostileSpawns[${i}].roomEnumKey`,
        `room ${JSON.stringify(spawn.roomEnumKey)} is not a room in this pack`,
      );
    }
    if (!hostileSlugs.has(spawn.hostileSlug)) {
      fail(
        `hostileSpawns[${i}].hostileSlug`,
        `hostile ${JSON.stringify(spawn.hostileSlug)} is not a hostile in this pack`,
      );
    }
  });

  return problems;
}

/**
 * Validate a pack, or throw with every problem listed.
 *
 * PRD-0002 R5: a pack that fails validation stops the boot rather than
 * producing a world with holes in it. That direction is deliberate. A world
 * seeded from a broken pack does not fail — it comes up with an exit that
 * goes nowhere and a spawn room that does not exist, and the first person to
 * find out is a player reading `(Bug: spawn room missing.)` in their
 * transcript. A boot that refuses names the fault to the operator instead,
 * while nobody is playing.
 */
export function assertValidContentPack(pack: ContentPack): void {
  const problems = validateContentPack(pack);
  if (problems.length === 0) return;
  const detail = problems
    .map(({ at, message }) => `  - ${at}: ${message}`)
    .join("\n");
  throw new Error(
    `content pack ${JSON.stringify(pack.key)} is invalid ` +
      `(${problems.length} problem${problems.length === 1 ? "" : "s"}):\n${detail}`,
  );
}
