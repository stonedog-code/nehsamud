import { CLASSES, ITEMS, MONSTERS, NPCS, RACES, ROOMS } from "../seed/fixtures/index.js";
import { pruneCatalog } from "../seed/seed.js";

/**
 * Removing catalog rows the fixtures no longer declare.
 *
 * The deletions are the easy half. The tests that matter are the REFUSALS:
 * pruning is the only part of the seed that can destroy something a player
 * owns, and the failure mode — a character whose sword or whose race stops
 * existing — is one nobody can undo afterwards.
 */

const SPAWN = "TOWNSMEE_TOWNSQUARE";

/**
 * Stale rows to add on top of the fixtures, plus who owns what.
 *
 * Every list here is ADDITIVE. An earlier version let a test replace the
 * room list outright, which silently removed the spawn room — and the prune
 * then correctly refused to touch anything, so the test failed for a reason
 * that had nothing to do with what it was checking.
 */
interface Extra {
  rooms?: Array<{ id: string; enumKey: string }>;
  npcs?: Array<{ id: string; slug: string }>;
  items?: Array<{ id: string; name: string }>;
  monsters?: Array<{ id: string; slug: string }>;
  races?: Array<{ id: string; slug: string }>;
  classes?: Array<{ id: string; slug: string }>;
  /** itemIds some player is carrying. */
  carried?: Set<string>;
  /** raceIds / classIds some character was built from. */
  inUse?: Set<string>;
  /** roomIds players are standing in. */
  occupied?: Set<string>;
  /** Drop the spawn room, to exercise the no-destination refusal. */
  withoutSpawn?: boolean;
}

/**
 * A database holding exactly what the fixtures declare, plus whatever stale
 * rows a test adds. Starting from "already correct" means every deletion an
 * assertion sees was caused by the stale row it introduced.
 */
function makeDb(extra: Extra = {}) {
  const fixtureRooms = ROOMS.filter(
    (r) => !(extra.withoutSpawn && r.enumKey === SPAWN),
  ).map((r, i) => ({ id: `room-${i}`, enumKey: r.enumKey }));

  const rows = {
    rooms: [...fixtureRooms, ...(extra.rooms ?? [])],
    npcs: [
      ...NPCS.map((n, i) => ({ id: `npc-${i}`, slug: n.slug })),
      ...(extra.npcs ?? []),
    ],
    items: [
      ...ITEMS.map((it, i) => ({ id: `item-${i}`, name: it.name })),
      ...(extra.items ?? []),
    ],
    monsters: [
      ...MONSTERS.map((m, i) => ({ id: `mon-${i}`, slug: m.slug })),
      ...(extra.monsters ?? []),
    ],
    races: [
      ...RACES.map((r, i) => ({ id: `race-${i}`, slug: r.slug })),
      ...(extra.races ?? []),
    ],
    classes: [
      ...CLASSES.map((c, i) => ({ id: `class-${i}`, slug: c.slug })),
      ...(extra.classes ?? []),
    ],
    carried: extra.carried ?? new Set<string>(),
    inUse: extra.inUse ?? new Set<string>(),
    occupied: extra.occupied ?? new Set<string>(),
  };

  const deleted = {
    rooms: [] as string[],
    npcs: [] as string[],
    items: [] as string[],
    monsters: [] as string[],
    races: [] as string[],
    classes: [] as string[],
  };
  let relocated = 0;

  const prisma = {
    mudMonster: {
      findMany: jest.fn(async () => rows.monsters),
      deleteMany: jest.fn(async (c: { where: { id: { in: string[] } } }) => {
        deleted.monsters.push(...c.where.id.in);
        return { count: c.where.id.in.length };
      }),
    },
    mudNpc: {
      findMany: jest.fn(async () => rows.npcs),
      deleteMany: jest.fn(async (c: { where: { id?: { in: string[] } } }) => {
        deleted.npcs.push(...(c.where.id?.in ?? []));
        return { count: c.where.id?.in?.length ?? 0 };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    mudItem: {
      findMany: jest.fn(async () => rows.items),
      delete: jest.fn(async (c: { where: { id: string } }) => {
        deleted.items.push(c.where.id);
      }),
    },
    mudInventory: {
      findFirst: jest.fn(async (c: { where: { itemId: string } }) =>
        rows.carried?.has(c.where.itemId) ? { id: "inv-1" } : null,
      ),
    },
    mudRoomItem: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    mudRoom: {
      findMany: jest.fn(async () => rows.rooms),
      findUnique: jest.fn(async (c: { where: { enumKey: string } }) => {
        const found = rows.rooms.find((r) => r.enumKey === c.where.enumKey);
        return found ? { id: found.id } : null;
      }),
      deleteMany: jest.fn(async (c: { where: { id: { in: string[] } } }) => {
        deleted.rooms.push(...c.where.id.in);
        return { count: c.where.id.in.length };
      }),
    },
    mudRace: {
      findMany: jest.fn(async () => rows.races),
      delete: jest.fn(async (c: { where: { id: string } }) => {
        deleted.races.push(c.where.id);
      }),
    },
    mudClass: {
      findMany: jest.fn(async () => rows.classes),
      delete: jest.fn(async (c: { where: { id: string } }) => {
        deleted.classes.push(c.where.id);
      }),
    },
    mudPlayer: {
      findFirst: jest.fn(
        async (c: { where: { raceId?: string; classId?: string } }) => {
          const key = c.where.raceId ?? c.where.classId ?? "";
          return rows.inUse?.has(key) ? { id: "player-1" } : null;
        },
      ),
      updateMany: jest.fn(
        async (c: { where: { roomId: { in: string[] } } }) => {
          const n = c.where.roomId.in.filter((id) =>
            rows.occupied?.has(id),
          ).length;
          relocated += n;
          return { count: n };
        },
      ),
    },
  };

  return {
    prisma: prisma as unknown as Parameters<typeof pruneCatalog>[0],
    deleted,
    relocated: () => relocated,
  };
}

/* ── what it removes ──────────────────────────────────────────── */

describe("pruneCatalog removes what no fixture declares", () => {
  it("removes nothing when the catalog already matches", async () => {
    // A seed that deletes on a matching database would be far worse than one
    // that keeps stale rows.
    const db = makeDb();
    const result = await pruneCatalog(db.prisma);
    expect(result).toEqual({
      rooms: [],
      npcs: [],
      items: [],
      monsters: [],
      races: [],
      classes: [],
      playersRelocated: 0,
    });
  });

  it("removes an orphaned NPC", async () => {
    // Ten of these were live on dev — half the NPCs a player could meet.
    const db = makeDb({
      npcs: [{ id: "npc-ghost", slug: "jaque" }],
    });
    const result = await pruneCatalog(db.prisma);
    expect(result.npcs).toEqual(["jaque"]);
    expect(db.deleted.npcs).toEqual(["npc-ghost"]);
  });

  it("removes an orphaned room", async () => {
    const db = makeDb({ rooms: [{ id: "room-ghost", enumKey: "OLD_WALL_7" }] });
    const result = await pruneCatalog(db.prisma);
    expect(result.rooms).toEqual(["OLD_WALL_7"]);
    expect(db.deleted.rooms).toEqual(["room-ghost"]);
  });

  it("removes an orphaned monster", async () => {
    const db = makeDb({
      monsters: [{ id: "mon-ghost", slug: "dire-badger" }],
    });
    expect((await pruneCatalog(db.prisma)).monsters).toEqual(["dire-badger"]);
  });

  it("leaves the rooms the fixtures still declare completely alone", async () => {
    const db = makeDb({ rooms: [{ id: "room-ghost", enumKey: "OLD_WALL_7" }] });
    await pruneCatalog(db.prisma);
    expect(db.deleted.rooms).not.toContain("room-0");
    expect(db.deleted.rooms).toHaveLength(1);
  });
});

/* ── what it refuses to remove ────────────────────────────────── */

describe("pruneCatalog refuses to destroy what a player owns", () => {
  it("will not prune an item somebody is carrying", async () => {
    // That is somebody's property. A fixture deletion that would take it is
    // skipped and reported, not cascaded — the loud failure is the point.
    const db = makeDb({
      items: [{ id: "item-heirloom", name: "Grandfather's Blade" }],
      carried: new Set(["item-heirloom"]),
    });
    const result = await pruneCatalog(db.prisma);
    expect(result.items).toEqual([]);
    expect(db.deleted.items).toEqual([]);
  });

  it("does prune an orphaned item nobody is carrying", async () => {
    const db = makeDb({
      items: [{ id: "item-junk", name: "Broken Cog" }],
    });
    expect((await pruneCatalog(db.prisma)).items).toEqual(["Broken Cog"]);
  });

  it("will not prune a race a character was built from", async () => {
    // The row is the only record of what that character is.
    const db = makeDb({
      races: [{ id: "race-gnome", slug: "gnome" }],
      inUse: new Set(["race-gnome"]),
    });
    expect((await pruneCatalog(db.prisma)).races).toEqual([]);
  });

  it("will not prune a class a character was built from", async () => {
    const db = makeDb({
      classes: [{ id: "class-druid", slug: "druid" }],
      inUse: new Set(["class-druid"]),
    });
    expect((await pruneCatalog(db.prisma)).classes).toEqual([]);
  });

  it("prunes an unused race", async () => {
    const db = makeDb({
      races: [{ id: "race-gnome", slug: "gnome" }],
    });
    expect((await pruneCatalog(db.prisma)).races).toEqual(["gnome"]);
  });
});

/* ── players standing in a room that is going away ────────────── */

describe("pruneCatalog moves players out before removing a room", () => {
  it("relocates them to the spawn and says how many", async () => {
    // Leaving them would be a foreign-key error at seed time; deleting them
    // is not on the table.
    const db = makeDb({
      rooms: [{ id: "room-ghost", enumKey: "OLD_WALL_7" }],
      occupied: new Set(["room-ghost"]),
    });
    const result = await pruneCatalog(db.prisma);
    expect(result.playersRelocated).toBe(1);
    expect(result.rooms).toEqual(["OLD_WALL_7"]);
  });

  it("refuses the whole room prune when there is no spawn to move them to", async () => {
    // Without a destination the only options are stranding a character or
    // failing the seed. Neither beats leaving the stale rows for one run.
    const db = makeDb({
      rooms: [{ id: "room-ghost", enumKey: "OLD_WALL_7" }],
      withoutSpawn: true,
    });
    const result = await pruneCatalog(db.prisma);
    expect(result.rooms).toEqual([]);
    expect(db.deleted.rooms).toEqual([]);
  });
});
