/**
 * Verifies the seeder's upsert semantics + the room-exit /
 * NPC-room cross-reference resolution against a mock PrismaClient.
 * We're testing the orchestration (right number of upserts in the
 * right order, exits resolved to UUIDs after rooms exist, NPCs
 * placed in real rooms) — not Postgres semantics, which the Phase
 * 9 integration suite will cover.
 */

import {
  CLASSES,
  EFFECTS,
  ITEMS,
  MONSTERS,
  NPCS,
  RACES,
  ROOMS,
} from "../seed/fixtures/index.js";
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
    race: [] as UpsertCall[],
    class: [] as UpsertCall[],
    room: [] as UpsertCall[],
    roomUpdates: [] as UpdateCall[],
    item: [] as UpsertCall[],
    monster: [] as UpsertCall[],
    npc: [] as UpsertCall[],
  };
  const roomIdByKey = new Map<string, string>();
  ROOMS.forEach((r, idx) => {
    roomIdByKey.set(r.enumKey, `room-${idx + 1}`);
  });
  return {
    calls,
    prisma: {
      mudRace: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.race.push(call);
        }),
      },
      mudClass: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.class.push(call);
        }),
      },
      mudRoom: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.room.push(call);
        }),
        findMany: jest.fn(async () =>
          Array.from(roomIdByKey).map(([enumKey, id]) => ({ id, enumKey })),
        ),
        update: jest.fn(async (call: UpdateCall) => {
          calls.roomUpdates.push(call);
        }),
      },
      mudItem: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.item.push(call);
        }),
      },
      mudMonster: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.monster.push(call);
        }),
      },
      mudNpc: {
        upsert: jest.fn(async (call: UpsertCall) => {
          calls.npc.push(call);
        }),
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
      races: RACES.length,
      classes: CLASSES.length,
      rooms: ROOMS.length,
      items: ITEMS.length,
      monsters: MONSTERS.length,
      npcs: NPCS.length,
    });

    expect(calls.race).toHaveLength(RACES.length);
    expect(calls.class).toHaveLength(CLASSES.length);
    expect(calls.room).toHaveLength(ROOMS.length);
    expect(calls.item).toHaveLength(ITEMS.length);
    expect(calls.monster).toHaveLength(MONSTERS.length);
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
