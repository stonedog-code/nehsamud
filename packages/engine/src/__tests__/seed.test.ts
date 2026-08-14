/**
 * Verifies the seeder's upsert semantics + the room-exit /
 * NPC-room cross-reference resolution against a mock PrismaClient.
 * We're testing the orchestration (right number of upserts in the
 * right order, exits resolved to UUIDs after rooms exist, NPCs
 * placed in real rooms) — not Postgres semantics, which the Phase
 * 9 integration suite will cover.
 */

import {
  CHARACTER_OPTION_GROUPS,
  EFFECTS,
  ITEMS,
  ITEM_PLACEMENTS,
  HOSTILES,
  NPCS,
  ROOMS,
} from "../seed/fixtures/index.js";

/** Every option across every declared group — what the seeder writes. */
const ALL_OPTIONS = CHARACTER_OPTION_GROUPS.flatMap((g) => g.options);
import { seedCatalog } from "../seed/seed.js";

interface UpsertCall<TWhere = unknown, TCreate = unknown, TUpdate = unknown> {
  where: TWhere;
  create: TCreate;
  update: TUpdate;
}

interface UpdateCall<TWhere = unknown, TData = unknown> {
  where: TWhere;
  data: TData;
}

function makeMockPrisma() {
  const calls = {
    optionGroup: [] as UpsertCall[],
    option: [] as UpsertCall[],
    room: [] as UpsertCall[],
    roomUpdates: [] as UpdateCall[],
    item: [] as UpsertCall[],
    roomItem: [] as Array<{ data: Record<string, unknown> }>,
    hostile: [] as UpsertCall[],
    npc: [] as UpsertCall[],
  };
  const roomIdByKey = new Map<string, string>();
  ROOMS.forEach((r, idx) => {
    roomIdByKey.set(r.enumKey, `room-${idx + 1}`);
  });
  return {
    calls,
    prisma: {
      // Every findMany below returns exactly what the fixtures declare, so
      // the prune step finds nothing stale and these orchestration tests stay
      // about seeding. Pruning has its own suite with its own fake.
      mudCharacterOptionGroup: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.optionGroup.push(call);
          const key = (call.where as { key: string }).key;
          return { id: `group-${key}` };
        }),
        findMany: jest.fn(async () =>
          CHARACTER_OPTION_GROUPS.map((g) => ({
            id: `group-${g.key}`,
            key: g.key,
          })),
        ),
        delete: jest.fn(async () => undefined),
      },
      mudCharacterOption: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.option.push(call);
        }),
        // Nothing stale: the prune asks for options OUTSIDE the declared
        // slugs, and this fake says there are none.
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        delete: jest.fn(async () => undefined),
      },
      mudPlayerOption: {
        findFirst: jest.fn(async () => null),
      },
      mudPlayer: {
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      mudInventory: {
        findFirst: jest.fn(async () => null),
      },
      mudRoom: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.room.push(call);
        }),
        findUnique: jest.fn(async (call: { where: { enumKey: string } }) => ({
          id: `room-${call.where.enumKey}`,
        })),
        findMany: jest.fn(async () =>
          Array.from(roomIdByKey).map(([enumKey, id]) => ({ id, enumKey })),
        ),
        update: jest.fn(async (call: UpdateCall) => {
          calls.roomUpdates.push(call);
        }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      mudItem: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.item.push(call);
        }),
        // Item placement joins rooms to items by their application keys.
        findUnique: jest.fn(async (call: { where: { name: string } }) => ({
          id: `item-${call.where.name.toLowerCase().replace(/\s+/g, "-")}`,
        })),
        findMany: jest.fn(async () =>
          ITEMS.map((i, idx) => ({ id: `item-${idx}`, name: i.name })),
        ),
        delete: jest.fn(async () => undefined),
      },
      // Room contents. findFirst returns null so a fresh world places its
      // starting items; the idempotent-skip path is covered separately.
      mudRoomItem: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (call: { data: Record<string, unknown> }) => {
          calls.roomItem.push(call);
          return call.data;
        }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      mudHostile: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.hostile.push(call);
        }),
        findMany: jest.fn(async () =>
          HOSTILES.map((m, i) => ({ id: `hostile-${i}`, slug: m.slug })),
        ),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      mudNpc: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.npc.push(call);
        }),
        findMany: jest.fn(async () =>
          NPCS.map((n, i) => ({ id: `npc-${i}`, slug: n.slug })),
        ),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    },
  };
}

describe("seedCatalog — orchestration", () => {
  it("upserts every fixture in every catalog", async () => {
    const { prisma, calls } = makeMockPrisma();
    // Cast: the mock only has the methods we use; Prisma's full
    // surface isn't reproduced here.
    const result = await seedCatalog(prisma as unknown as Parameters<typeof seedCatalog>[0]);

    expect(result).toEqual({
      optionGroups: CHARACTER_OPTION_GROUPS.length,
      options: ALL_OPTIONS.length,
      rooms: ROOMS.length,
      items: ITEMS.length,
      // Every placement lands in a fresh world; the fake reports each room as
      // empty. A re-run against a populated room places none — that skip is
      // what stops the seed duplicating a sword or sweeping up something a
      // player dropped.
      placements: ITEM_PLACEMENTS.length,
      hostiles: HOSTILES.length,
      npcs: NPCS.length,
      // Nothing stale in this fake, so the prune reports an empty removal in
      // every category. That IS the assertion: a seed against a database
      // already matching the fixtures must not delete anything.
      pruned: {
        rooms: [],
        npcs: [],
        items: [],
        hostiles: [],
        optionGroups: [],
        options: [],
        playersRelocated: 0,
      },
    });

    expect(calls.optionGroup).toHaveLength(CHARACTER_OPTION_GROUPS.length);
    expect(calls.option).toHaveLength(ALL_OPTIONS.length);
    expect(calls.room).toHaveLength(ROOMS.length);
    expect(calls.item).toHaveLength(ITEMS.length);
    expect(calls.hostile).toHaveLength(HOSTILES.length);
    expect(calls.npc).toHaveLength(NPCS.length);
  });

  it("upserts rooms first WITHOUT exits, then patches exits to resolved UUIDs", async () => {
    const { prisma, calls } = makeMockPrisma();
    await seedCatalog(prisma as unknown as Parameters<typeof seedCatalog>[0]);

    // First-pass create payloads include `exits: {}`.
    for (const call of calls.room) {
      expect((call.create as { exits: unknown }).exits).toEqual({});
    }

    // Every room in the fixture set is updated to point at real
    // UUIDs, not enumKeys.
    expect(calls.roomUpdates).toHaveLength(ROOMS.length);
    for (const update of calls.roomUpdates) {
      const exits = (update.data as { exits: Record<string, string> }).exits;
      for (const target of Object.values(exits)) {
        // The mock produced `room-1`, `room-2`, … so confirm we're
        // looking at one of those, not an enumKey leak.
        expect(target).toMatch(/^room-\d+$/);
      }
    }
  });

  it("places NPCs in the correct room IDs", async () => {
    const { prisma, calls } = makeMockPrisma();
    await seedCatalog(prisma as unknown as Parameters<typeof seedCatalog>[0]);

    // Build expected: NPC slug → room enumKey → expected room ID
    // ("room-N" from the mock).
    const expectedRoomById = new Map(
      ROOMS.map((r, idx) => [r.enumKey, `room-${idx + 1}`]),
    );

    for (const npcCall of calls.npc) {
      const create = npcCall.create as { slug: string; roomId: string | null };
      const fixture = NPCS.find((n) => n.slug === create.slug);
      if (!fixture) throw new Error(`upsert for unknown NPC ${create.slug}`);
      if (fixture.roomEnumKey === null) {
        expect(create.roomId).toBeNull();
      } else {
        expect(create.roomId).toBe(expectedRoomById.get(fixture.roomEnumKey));
      }
    }
  });

  it("Zofia ends up in the inn — sanity check on the wired-up fixture", async () => {
    const { prisma, calls } = makeMockPrisma();
    await seedCatalog(prisma as unknown as Parameters<typeof seedCatalog>[0]);
    const zofiaCall = calls.npc.find(
      (c) => (c.create as { slug: string }).slug === "zofia",
    );
    expect(zofiaCall).toBeDefined();
    const innRoom = ROOMS.find((r) => r.enumKey === "TOWNSMEE_INN");
    if (!innRoom) throw new Error("seed fixture lost the inn room");
    const innIdx = ROOMS.indexOf(innRoom);
    expect((zofiaCall?.create as { roomId: string }).roomId).toBe(
      `room-${innIdx + 1}`,
    );
  });
});
