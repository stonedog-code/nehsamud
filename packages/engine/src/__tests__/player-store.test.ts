/**
 * loadPlayer + createPlayer + loadOrCreatePlayer + savePlayerState
 * against a stubbed PrismaClient. No real DB; Phase 9 integration
 * suite exercises the real schema.
 */

import {
  createPlayer,
  loadOrCreatePlayer,
  loadPlayer,
  savePlayerState,
} from "../persistence/player-store.js";

interface MockPlayer {
  id: string;
  userId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  /* The seven attribute columns and the two relations `statistics` reads.
   * A fake missing them does not fail loudly — `loadPlayer` unpacks
   * `row.race.name` and throws a TypeError from inside persistence, which
   * surfaces three layers away as a socket that never answers. */
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
  race: { name: string };
  class: { name: string };
}

/** The attribute half of a row, at the schema's own defaults. */
const DEFAULT_ATTRIBUTES = {
  strength: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  constitution: 10,
  dexterity: 10,
  luck: 10,
  race: { name: "Human" },
  class: { name: "Warrior" },
};

function makePrisma(options: {
  existingPlayer?: MockPlayer;
  raceId?: string;
  classId?: string;
}) {
  const findFirst = jest.fn(async () => options.existingPlayer ?? null);
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => {
    const created: MockPlayer = {
      id: "player-new",
      userId: args.data.userId as string,
      name: args.data.name as string,
      roomId: args.data.roomId as string | null,
      currentHp: args.data.currentHp as number,
      maxHp: args.data.maxHp as number,
      experience: args.data.experience as number,
      level: 1,
      ...DEFAULT_ATTRIBUTES,
    };
    return created;
  });
  const update = jest.fn(async () => undefined);
  return {
    mudPlayer: { findFirst, create, update },
    mudRace: {
      findFirst: jest.fn(async () =>
        options.raceId ? { id: options.raceId } : null,
      ),
    },
    mudClass: {
      findFirst: jest.fn(async () =>
        options.classId ? { id: options.classId } : null,
      ),
    },
  };
}

describe("loadPlayer", () => {
  it("returns null when the user has no character yet", async () => {
    const prisma = makePrisma({});
    const result = await loadPlayer(
      prisma as unknown as Parameters<typeof loadPlayer>[0],
      "u-new",
    );
    expect(result).toBeNull();
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("returns the existing row when the user already has a character", async () => {
    const player: MockPlayer = {
      id: "player-1",
      userId: "u-1",
      name: "Aelric",
      roomId: "room-saved",
      currentHp: 17,
      maxHp: 30,
      experience: 55,
      level: 2,
      ...DEFAULT_ATTRIBUTES,
    };
    const prisma = makePrisma({ existingPlayer: player });
    const result = await loadPlayer(
      prisma as unknown as Parameters<typeof loadPlayer>[0],
      "u-1",
    );
    // The row is MAPPED, not returned raw: the two relations collapse to
    // `raceName`/`className` and the seven attribute columns move under
    // `attributes`, so a caller cannot reach a stat without going through the
    // shape both load paths share.
    expect(result).toEqual({
      id: player.id,
      userId: player.userId,
      name: player.name,
      roomId: player.roomId,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      experience: player.experience,
      level: player.level,
      raceName: "Human",
      className: "Warrior",
      attributes: {
        strength: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        constitution: 10,
        dexterity: 10,
        luck: 10,
      },
    });
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });
});

describe("createPlayer", () => {
  it("creates a player at the spawn room with the supplied name", async () => {
    const prisma = makePrisma({ raceId: "race-1", classId: "class-1" });
    const result = await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "Aelric",
      "room-spawn",
    );
    expect(prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe("u-1");
    expect(result.name).toBe("Aelric");
    expect(result.roomId).toBe("room-spawn");
    expect(result.currentHp).toBe(result.maxHp);
  });

  it("trims surrounding whitespace from the name", async () => {
    const prisma = makePrisma({ raceId: "race-1", classId: "class-1" });
    const result = await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "  Aelric  ",
      "room-spawn",
    );
    expect(result.name).toBe("Aelric");
    const createArgs = prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.name).toBe("Aelric");
  });

  it("rejects a blank name before touching the database", async () => {
    const prisma = makePrisma({ raceId: "race-1", classId: "class-1" });
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "   ",
        "room-spawn",
      ),
    ).rejects.toThrow(/name is required/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("throws when the seed hasn't run (no playable race or class)", async () => {
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "Aelric",
        "room-spawn",
      ),
    ).rejects.toThrow(/no playable race or class/);
  });
});

describe("loadOrCreatePlayer", () => {
  it("returns the existing player row when one exists for the user", async () => {
    const player: MockPlayer = {
      id: "player-1",
      userId: "u-1",
      name: "Traveler-abc",
      roomId: "room-saved",
      currentHp: 17,
      maxHp: 30,
      experience: 55,
      level: 2,
      ...DEFAULT_ATTRIBUTES,
    };
    const prisma = makePrisma({ existingPlayer: player });
    const result = await loadOrCreatePlayer(
      prisma as unknown as Parameters<typeof loadOrCreatePlayer>[0],
      "u-1",
      "room-spawn",
    );
    // The row is MAPPED, not returned raw: the two relations collapse to
    // `raceName`/`className` and the seven attribute columns move under
    // `attributes`, so a caller cannot reach a stat without going through the
    // shape both load paths share.
    expect(result).toEqual({
      id: player.id,
      userId: player.userId,
      name: player.name,
      roomId: player.roomId,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      experience: player.experience,
      level: player.level,
      raceName: "Human",
      className: "Warrior",
      attributes: {
        strength: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        constitution: 10,
        dexterity: 10,
        luck: 10,
      },
    });
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("creates a new player at the spawn room when none exists", async () => {
    const prisma = makePrisma({ raceId: "race-1", classId: "class-1" });
    const result = await loadOrCreatePlayer(
      prisma as unknown as Parameters<typeof loadOrCreatePlayer>[0],
      "u-1",
      "room-spawn",
    );
    expect(prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe("u-1");
    expect(result.roomId).toBe("room-spawn");
    expect(result.currentHp).toBe(result.maxHp);
    expect(result.name).toMatch(/^Traveler-[a-f0-9]{8}$/);
  });

  it("throws when the seed hasn't run (no playable race or class)", async () => {
    const prisma = makePrisma({});
    await expect(
      loadOrCreatePlayer(
        prisma as unknown as Parameters<typeof loadOrCreatePlayer>[0],
        "u-1",
        "room-spawn",
      ),
    ).rejects.toThrow(/no playable race or class/);
  });
});

describe("savePlayerState", () => {
  it("issues an update with the session's mutable fields + bumps lastSeenAt", async () => {
    const prisma = makePrisma({});
    await savePlayerState(
      prisma as unknown as Parameters<typeof savePlayerState>[0],
      "player-1",
      {
        currentRoomId: "room-inn",
        currentHp: 22,
        maxHp: 30,
        experience: 100,
      },
    );
    expect(prisma.mudPlayer.update).toHaveBeenCalledTimes(1);
    const call = (prisma.mudPlayer.update as jest.Mock).mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe("player-1");
    expect(call.data.roomId).toBe("room-inn");
    expect(call.data.currentHp).toBe(22);
    expect(call.data.maxHp).toBe(30);
    expect(call.data.experience).toBe(100);
    expect(call.data.lastSeenAt).toBeInstanceOf(Date);
  });
});
