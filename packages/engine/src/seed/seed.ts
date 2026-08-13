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
  return { races, classes, rooms, items, placements, monsters, npcs };
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
