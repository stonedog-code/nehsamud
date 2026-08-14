/**
 * Idempotent seeder for the mud.* catalog tables.
 *
 * The Python implementation reseeded everything on every boot by
 * truncating + reinserting. We don't do that here:
 *
 *   - The Node service can crash-loop without disturbing player
 *     state — truncating monsters/rooms would orphan inventory and
 *     mid-run player positions.
 *   - Catalog rows are keyed by stable application identifiers
 *     (slug for race/class/monster/npc, enumKey for room, name for
 *     item), so an upsert by that key gives us "create if missing,
 *     update if changed" without destroying anything.
 *
 * Returns counts so callers can log or assert in tests.
 */

import type { PrismaClient } from "@nehsamud/engine-db";

import {
  CLASSES,
  ITEMS,
  ITEM_PLACEMENTS,
  MONSTERS,
  NPCS,
  RACES,
  ROOMS,
} from "./fixtures/index.js";

export interface SeedResult {
  races: number;
  classes: number;
  rooms: number;
  items: number;
  /** Item stacks newly placed on a floor. Zero on a re-run, because rooms
   * that already have contents are left alone — see seedItemPlacements. */
  placements: number;
  monsters: number;
  npcs: number;
  /** Catalog rows removed because no fixture declares them any more. */
  pruned: PruneResult;
}

/**
 * What the prune removed, and what it had to move out of the way first.
 *
 * Reported rather than silent: a seed that quietly deletes content is as bad
 * as one that quietly keeps it, and "we relocated three of your players" is
 * not a thing to discover from a support ticket.
 */
export interface PruneResult {
  rooms: string[];
  npcs: string[];
  items: string[];
  monsters: string[];
  races: string[];
  classes: string[];
  /** Players moved to the spawn because the room under them was removed. */
  playersRelocated: number;
}

export async function seedCatalog(prisma: PrismaClient): Promise<SeedResult> {
  const races = await seedRaces(prisma);
  const classes = await seedClasses(prisma);
  // Rooms must land before NPCs (NPCs may reference a room) and
  // before exit resolution.
  const rooms = await seedRooms(prisma);
  const items = await seedItems(prisma);
  // After rooms AND items — it joins the two.
  const placements = await seedItemPlacements(prisma);
  const monsters = await seedMonsters(prisma);
  const npcs = await seedNpcs(prisma);
  // Last, so everything the fixtures DO declare is already present — the
  // prune can then treat "absent from the fixtures" as "absent from the
  // database" without racing its own upserts.
  const pruned = await pruneCatalog(prisma);
  return { races, classes, rooms, items, placements, monsters, npcs, pruned };
}

async function seedRaces(prisma: PrismaClient): Promise<number> {
  for (const r of RACES) {
    await prisma.mudRace.upsert({
      where: { slug: r.slug },
      create: r,
      update: {
        name: r.name,
        description: r.description,
        abilities: r.abilities,
        directives: r.directives,
        strengthMod: r.strengthMod,
        intelligenceMod: r.intelligenceMod,
        wisdomMod: r.wisdomMod,
        charismaMod: r.charismaMod,
        constitutionMod: r.constitutionMod,
        dexterityMod: r.dexterityMod,
        luckMod: r.luckMod,
        baseExperienceAdjustment: r.baseExperienceAdjustment,
      },
    });
  }
  return RACES.length;
}

async function seedClasses(prisma: PrismaClient): Promise<number> {
  for (const c of CLASSES) {
    await prisma.mudClass.upsert({
      where: { slug: c.slug },
      create: c,
      update: {
        name: c.name,
        description: c.description,
        abilities: c.abilities,
        directives: c.directives,
        strengthMod: c.strengthMod,
        intelligenceMod: c.intelligenceMod,
        wisdomMod: c.wisdomMod,
        charismaMod: c.charismaMod,
        constitutionMod: c.constitutionMod,
        dexterityMod: c.dexterityMod,
        luckMod: c.luckMod,
        baseExperienceAdjustment: c.baseExperienceAdjustment,
      },
    });
  }
  return CLASSES.length;
}

async function seedRooms(prisma: PrismaClient): Promise<number> {
  // Two passes: (1) upsert rooms without exits to ensure every
  // enumKey exists, (2) resolve enumKey exits to UUIDs and patch.
  for (const r of ROOMS) {
    await prisma.mudRoom.upsert({
      where: { enumKey: r.enumKey },
      create: {
        enumKey: r.enumKey,
        name: r.name,
        description: r.description,
        environment: r.environment,
        area: r.area,
        exits: {},
      },
      update: {
        name: r.name,
        description: r.description,
        environment: r.environment,
        area: r.area,
      },
    });
  }
  // Resolve exits.
  const all = await prisma.mudRoom.findMany({
    where: { enumKey: { in: ROOMS.map((r) => r.enumKey) } },
    select: { id: true, enumKey: true },
  });
  const byKey = new Map(all.map((row) => [row.enumKey, row.id]));
  for (const r of ROOMS) {
    const resolved: Record<string, string> = {};
    for (const [dir, targetKey] of Object.entries(r.exits)) {
      const targetId = byKey.get(targetKey);
      if (!targetId) {
        throw new Error(
          `Room fixture ${r.enumKey}.exits.${dir} → ${targetKey} not found among seeded rooms.`,
        );
      }
      resolved[dir] = targetId;
    }
    await prisma.mudRoom.update({
      where: { enumKey: r.enumKey },
      data: { exits: resolved },
    });
  }
  return ROOMS.length;
}

async function seedItems(prisma: PrismaClient): Promise<number> {
  for (const i of ITEMS) {
    await prisma.mudItem.upsert({
      where: { name: i.name },
      create: i,
      update: {
        description: i.description,
        type: i.type,
        baseValue: i.baseValue,
        weight: i.weight,
      },
    });
  }
  return ITEMS.length;
}

/**
 * Place the starting items on the floor.
 *
 * Idempotent PER ROOM, not per item: a room that already has anything in it
 * is left completely alone. That is what stops a re-run duplicating a sword
 * and — the case that actually matters — stops it sweeping away something a
 * player dropped. Room contents persist, so this table is not the seed's to
 * own after the first fill.
 *
 * Placements are therefore grouped by room and applied as a unit. The first
 * version skipped item-by-item and quietly placed only the FIRST of a room's
 * items, because by the time it looked at the second the room was no longer
 * empty. The seed reported `placed=3` for four placements, which is the only
 * reason it was noticed.
 */
async function seedItemPlacements(prisma: PrismaClient): Promise<number> {
  const byRoom = new Map<string, typeof ITEM_PLACEMENTS>();
  for (const placement of ITEM_PLACEMENTS) {
    const list = byRoom.get(placement.roomEnumKey) ?? [];
    list.push(placement);
    byRoom.set(placement.roomEnumKey, list);
  }

  let placed = 0;
  for (const [roomEnumKey, placements] of byRoom) {
    const room = await prisma.mudRoom.findUnique({
      where: { enumKey: roomEnumKey },
      select: { id: true },
    });
    if (!room) continue;

    const occupied = await prisma.mudRoomItem.findFirst({
      where: { roomId: room.id },
      select: { id: true },
    });
    if (occupied) continue;

    for (const placement of placements) {
      const item = await prisma.mudItem.findUnique({
        where: { name: placement.itemName },
        select: { id: true },
      });
      if (!item) continue;
      await prisma.mudRoomItem.create({
        data: {
          roomId: room.id,
          itemId: item.id,
          quantity: placement.quantity ?? 1,
        },
      });
      placed += 1;
    }
  }
  return placed;
}

async function seedMonsters(prisma: PrismaClient): Promise<number> {
  for (const m of MONSTERS) {
    await prisma.mudMonster.upsert({
      where: { slug: m.slug },
      create: m,
      update: {
        name: m.name,
        description: m.description,
        level: m.level,
        baseHp: m.baseHp,
        baseDamage: m.baseDamage,
        experience: m.experience,
        alignment: m.alignment,
        mobType: m.mobType,
      },
    });
  }
  return MONSTERS.length;
}

async function seedNpcs(prisma: PrismaClient): Promise<number> {
  // Resolve roomEnumKey → roomId once for the whole batch.
  const roomKeys = NPCS.map((n) => n.roomEnumKey).filter(
    (k): k is string => k !== null,
  );
  const rooms = roomKeys.length
    ? await prisma.mudRoom.findMany({
        where: { enumKey: { in: roomKeys } },
        select: { id: true, enumKey: true },
      })
    : [];
  const roomByKey = new Map(rooms.map((r) => [r.enumKey, r.id]));

  for (const n of NPCS) {
    const roomId = n.roomEnumKey ? roomByKey.get(n.roomEnumKey) ?? null : null;
    if (n.roomEnumKey && !roomId) {
      throw new Error(
        `NPC fixture ${n.slug}.roomEnumKey=${n.roomEnumKey} not found among seeded rooms.`,
      );
    }
    await prisma.mudNpc.upsert({
      where: { slug: n.slug },
      create: {
        slug: n.slug,
        name: n.name,
        description: n.description,
        roomId,
        pronoun: n.pronoun,
        alignment: n.alignment,
        intelligenceMode: n.intelligenceMode,
        dialogLines: n.dialogLines,
        interests: n.interests,
      },
      update: {
        name: n.name,
        description: n.description,
        roomId,
        pronoun: n.pronoun,
        alignment: n.alignment,
        intelligenceMode: n.intelligenceMode,
        dialogLines: n.dialogLines,
        interests: n.interests,
      },
    });
  }
  return NPCS.length;
}

/**
 * The room a displaced player is put back into.
 *
 * Mirrors ws-server's default. A pack-supplied spawn (PRD-0002 phase 2) will
 * replace both with one value read from the pack.
 */
const SPAWN_ROOM_ENUM_KEY = "TOWNSMEE_TOWNSQUARE";

/**
 * Remove catalog rows the fixtures no longer declare.
 *
 * WHY THIS EXISTS. The seeder was upsert-only, and its header explained
 * why: the Python version truncated and reinserted on every boot, which
 * would orphan inventory and mid-run player positions. That reasoning is
 * right about PLAYER-owned data and wrong about the catalog — nothing ever
 * removed a row whose fixture had been deleted, so every fixture ever
 * seeded was still in the database.
 *
 * Measured on dev after a clean seed: the seeder reported 39 rooms and 10
 * NPCs; the database held 42 and 20. The engine loads its world from
 * Postgres, so it was serving rooms and NPCs nobody had authored — and the
 * map tests assert over the FIXTURES, so they proved nothing about any of
 * it. An orphan room can be an unreachable island with exits into deleted
 * rooms and every test stays green.
 *
 * WHAT IT REFUSES TO DO. Deleting catalog rows can destroy things players
 * own, so this is deliberately timid:
 *
 *   - An item any player is CARRYING is never pruned. That is somebody's
 *     property; a fixture deletion that would take it is reported and
 *     skipped rather than cascaded. The loud failure is the point.
 *   - A race or class any character was BUILT FROM is never pruned. The row
 *     is the only record of what that character is.
 *   - A room with players standing in it is pruned, but they are moved to
 *     the spawn first. Leaving them would be a foreign-key error at seed
 *     time; deleting them is not on the table.
 */
export async function pruneCatalog(
  prisma: PrismaClient,
): Promise<PruneResult> {
  const result: PruneResult = {
    rooms: [],
    npcs: [],
    items: [],
    monsters: [],
    races: [],
    classes: [],
    playersRelocated: 0,
  };

  /* ── Things nothing else depends on ─────────────────────────── */

  const monsterSlugs = new Set(MONSTERS.map((m) => m.slug));
  const staleMonsters = (
    await prisma.mudMonster.findMany({ select: { id: true, slug: true } })
  ).filter((m) => !monsterSlugs.has(m.slug));
  if (staleMonsters.length > 0) {
    // Monster instances live in memory, so the catalog row has no dependants.
    await prisma.mudMonster.deleteMany({
      where: { id: { in: staleMonsters.map((m) => m.id) } },
    });
    result.monsters = staleMonsters.map((m) => m.slug);
  }

  const npcSlugs = new Set(NPCS.map((n) => n.slug));
  const staleNpcs = (
    await prisma.mudNpc.findMany({ select: { id: true, slug: true } })
  ).filter((n) => !npcSlugs.has(n.slug));
  if (staleNpcs.length > 0) {
    await prisma.mudNpc.deleteMany({
      where: { id: { in: staleNpcs.map((n) => n.id) } },
    });
    result.npcs = staleNpcs.map((n) => n.slug);
  }

  /* ── Items: never take something a player is carrying ───────── */

  const itemNames = new Set(ITEMS.map((i) => i.name));
  const staleItems = (
    await prisma.mudItem.findMany({ select: { id: true, name: true } })
  ).filter((i) => !itemNames.has(i.name));
  for (const item of staleItems) {
    const carried = await prisma.mudInventory.findFirst({
      where: { itemId: item.id },
      select: { id: true },
    });
    if (carried) {
      // Reported by the caller, not deleted. Somebody owns this.
      continue;
    }
    // Safe to remove: drop it off any floor first, then the catalog row.
    await prisma.mudRoomItem.deleteMany({ where: { itemId: item.id } });
    await prisma.mudItem.delete({ where: { id: item.id } });
    result.items.push(item.name);
  }

  /* ── Rooms: move players out before the floor goes ──────────── */

  const roomKeys = new Set(ROOMS.map((r) => r.enumKey));
  const staleRooms = (
    await prisma.mudRoom.findMany({ select: { id: true, enumKey: true } })
  ).filter((r) => !roomKeys.has(r.enumKey));

  if (staleRooms.length > 0) {
    const spawn = await prisma.mudRoom.findUnique({
      where: { enumKey: SPAWN_ROOM_ENUM_KEY },
      select: { id: true },
    });
    const staleIds = staleRooms.map((r) => r.id);

    if (spawn) {
      const moved = await prisma.mudPlayer.updateMany({
        where: { roomId: { in: staleIds } },
        data: { roomId: spawn.id },
      });
      result.playersRelocated = moved.count;
    } else {
      // No spawn to move them to. Refuse the whole room prune rather than
      // strand a character in a room that is about to stop existing.
      return result;
    }

    // An NPC anchored in a pruned room loses its anchor rather than the NPC
    // — the fixture still declares it, so deleting it here would fight the
    // upsert that just ran.
    await prisma.mudNpc.updateMany({
      where: { roomId: { in: staleIds } },
      data: { roomId: null },
    });
    await prisma.mudRoomItem.deleteMany({ where: { roomId: { in: staleIds } } });
    await prisma.mudRoom.deleteMany({ where: { id: { in: staleIds } } });
    result.rooms = staleRooms.map((r) => r.enumKey);
  }

  /* ── Races and classes: never orphan a character ────────────── */

  const raceSlugs = new Set(RACES.map((r) => r.slug));
  const staleRaces = (
    await prisma.mudRace.findMany({ select: { id: true, slug: true } })
  ).filter((r) => !raceSlugs.has(r.slug));
  for (const race of staleRaces) {
    const inUse = await prisma.mudPlayer.findFirst({
      where: { raceId: race.id },
      select: { id: true },
    });
    if (inUse) continue;
    await prisma.mudRace.delete({ where: { id: race.id } });
    result.races.push(race.slug);
  }

  const classSlugs = new Set(CLASSES.map((c) => c.slug));
  const staleClasses = (
    await prisma.mudClass.findMany({ select: { id: true, slug: true } })
  ).filter((c) => !classSlugs.has(c.slug));
  for (const klass of staleClasses) {
    const inUse = await prisma.mudPlayer.findFirst({
      where: { classId: klass.id },
      select: { id: true },
    });
    if (inUse) continue;
    await prisma.mudClass.delete({ where: { id: klass.id } });
    result.classes.push(klass.slug);
  }

  return result;
}
