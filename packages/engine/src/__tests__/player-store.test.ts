/**
 * loadPlayer + createPlayer + loadOrCreatePlayer + savePlayerState
 * against a stubbed PrismaClient. No real DB; the integration suite
 * exercises the real schema.
 */

import { deriveCharacter } from "../character.js";
import {
  createPlayer,
  loadOrCreatePlayer,
  loadPlayer,
  savePlayerState,
} from "../persistence/player-store.js";

/** One row of `mud.player_option`, joined out as the select asks for it. */
interface MockPlayerOption {
  group: { key: string; name: string; position: number };
  option: { slug: string; name: string };
}

interface MockPlayer {
  id: string;
  ownerId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  /* The seven attribute columns and the option rows `statistics` reads.
   * A fake missing them does not fail loudly — `loadPlayer` unpacks them
   * and throws a TypeError from inside persistence, which surfaces three
   * layers away as a socket that never answers. */
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
  options: MockPlayerOption[];
}

/** Modifier sets the fake option rows carry, mirroring the real seed. */
const DWARF_MODS = {
  strengthMod: 2,
  intelligenceMod: 0,
  wisdomMod: 1,
  charismaMod: -1,
  constitutionMod: 2,
  dexterityMod: 0,
  luckMod: 0,
};
const MAGE_MODS = {
  strengthMod: -1,
  intelligenceMod: 3,
  wisdomMod: 2,
  charismaMod: 0,
  constitutionMod: -1,
  dexterityMod: 0,
  luckMod: 0,
};

/** The attribute half of a row, at the schema's own defaults. */
const DEFAULT_ATTRIBUTES = {
  strength: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  constitution: 10,
  dexterity: 10,
  luck: 10,
  options: [
    // Deliberately stored out of order, so the sort in `toRecord` is doing
    // something: a character sheet that reshuffles between logins is the
    // failure this guards.
    {
      group: { key: "class", name: "Class", position: 1 },
      option: { slug: "warrior", name: "Warrior" },
    },
    {
      group: { key: "race", name: "Race", position: 0 },
      option: { slug: "human", name: "Human" },
    },
  ],
};

/** The record shape both load paths must produce for DEFAULT_ATTRIBUTES. */
const EXPECTED_DEFAULTS = {
  options: [
    { groupKey: "race", groupName: "Race", optionSlug: "human", optionName: "Human" },
    {
      groupKey: "class",
      groupName: "Class",
      optionSlug: "warrior",
      optionName: "Warrior",
    },
  ],
  attributes: {
    strength: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    constitution: 10,
    dexterity: 10,
    luck: 10,
  },
};

/** The two axes the fake world declares, as the group table holds them. */
const GROUP_ROWS = [
  { id: "group-race", key: "race", name: "Race", required: true, position: 0 },
  {
    id: "group-class",
    key: "class",
    name: "Class",
    required: true,
    position: 1,
  },
];

const OPTION_ROWS: Record<
  string,
  { id: string; slug: string; name: string; selectable: boolean } & typeof DWARF_MODS
> = {
  "group-race:dwarf": {
    id: "option-dwarf",
    slug: "dwarf",
    name: "Dwarf",
    selectable: true,
    ...DWARF_MODS,
  },
  "group-class:mage": {
    id: "option-mage",
    slug: "mage",
    name: "Mage",
    selectable: true,
    ...MAGE_MODS,
  },
  // Present but withdrawn — a character already built from it keeps working,
  // a new one may not choose it.
  "group-class:necromancer": {
    id: "option-necromancer",
    slug: "necromancer",
    name: "Necromancer",
    selectable: false,
    ...MAGE_MODS,
  },
};

function makePrisma(options: {
  existingPlayer?: MockPlayer;
  /** Declare no axes at all — the care-centre pack. */
  noGroups?: boolean;
  /** Declared axes with nothing selectable on them — an unseeded world. */
  noOptions?: boolean;
}) {
  const groups = options.noGroups ? [] : GROUP_ROWS;
  const findFirst = jest.fn(async () => options.existingPlayer ?? null);
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => {
    const created: MockPlayer = {
      id: "player-new",
      ownerId: args.data.ownerId as string,
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
    mudCharacterOptionGroup: {
      // Serves both shapes the module asks for: the bare group list that
      // `createPlayer` validates against, and the nested selectable options
      // that `listOptionGroups` returns to a creation flow.
      findMany: jest.fn(async (args?: { select?: { options?: unknown } }) =>
        groups.map((g) =>
          args?.select?.options
            ? {
                ...g,
                options: options.noOptions
                  ? []
                  : Object.entries(OPTION_ROWS)
                      .filter(
                        ([key, row]) =>
                          key.startsWith(`${g.id}:`) && row.selectable,
                      )
                      .map(([, row]) => ({
                        slug: row.slug,
                        name: row.name,
                        description: "",
                      })),
              }
            : g,
        ),
      ),
    },
    mudCharacterOption: {
      // Keyed by (group, slug), because slugs are unique only within their
      // group — a lookup by slug alone could answer one axis with an option
      // belonging to another.
      findUnique: jest.fn(
        async (args: { where: { groupId_slug: { groupId: string; slug: string } } }) => {
          if (options.noOptions) return null;
          const { groupId, slug } = args.where.groupId_slug;
          return OPTION_ROWS[`${groupId}:${slug}`] ?? null;
        },
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
      ownerId: "u-1",
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
    // The row is MAPPED, not returned raw: the option rows collapse to a
    // flat list in DECLARED ORDER, and the seven attribute columns move
    // under `attributes`, so a caller cannot reach a stat without going
    // through the shape both load paths share.
    expect(result).toEqual({
      id: player.id,
      ownerId: player.ownerId,
      name: player.name,
      roomId: player.roomId,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      experience: player.experience,
      level: player.level,
      ...EXPECTED_DEFAULTS,
    });
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });
});

describe("createPlayer", () => {
  it("creates a player at the spawn room with the supplied name", async () => {
    const prisma = makePrisma({});
    const result = await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "Aelric",
      "room-spawn",
      { race: "dwarf", class: "mage" },
    );
    expect(prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    expect(result.ownerId).toBe("u-1");
    expect(result.name).toBe("Aelric");
    expect(result.roomId).toBe("room-spawn");
    expect(result.currentHp).toBe(result.maxHp);
  });

  it("trims surrounding whitespace from the name", async () => {
    const prisma = makePrisma({});
    const result = await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "  Aelric  ",
      "room-spawn",
      { race: "dwarf", class: "mage" },
    );
    expect(result.name).toBe("Aelric");
    const createArgs = prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.name).toBe("Aelric");
  });

  it("rejects a blank name before touching the database", async () => {
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "   ",
        "room-spawn",
  { race: "dwarf", class: "mage" },
      ),
    ).rejects.toThrow(/name is required/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("refuses an option that does not exist, rather than substituting one", async () => {
    // The silent fallback this replaces is what made every character in the
    // database the same race and class.
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "Aelric",
        "room-spawn",
        { race: "wombat", class: "mage" },
      ),
    ).rejects.toThrow(/not a selectable Race/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("refuses an option that exists but is not selectable", async () => {
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "Aelric",
        "room-spawn",
        { race: "dwarf", class: "necromancer" },
      ),
    ).rejects.toThrow(/not a selectable Class/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("refuses to leave a required axis unanswered", async () => {
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "Aelric",
        "room-spawn",
        { race: "dwarf" },
      ),
    ).rejects.toThrow(/"Class" is required/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("refuses an answer for an axis the pack does not declare", async () => {
    // A stale client, or a script written against another pack. Dropping it
    // silently would create a character that is not the one asked for.
    const prisma = makePrisma({});
    await expect(
      createPlayer(
        prisma as unknown as Parameters<typeof createPlayer>[0],
        "u-1",
        "Aelric",
        "room-spawn",
        { race: "dwarf", class: "mage", alignment: "evil" },
      ),
    ).rejects.toThrow(/"alignment" is not a character option group/);
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("creates a character for a pack that declares no axes at all", async () => {
    // The care-centre world: you are simply a resident. It must produce a
    // real character rather than refusing for lack of a race.
    const prisma = makePrisma({ noGroups: true });
    const result = await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "Margaret",
      "room-spawn",
      {},
    );
    expect(result.name).toBe("Margaret");
    const data = (
      prisma.mudPlayer.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.options).toEqual({ create: [] });
    // Straight base attributes, not zero.
    expect(data.strength).toBe(10);
  });

  it("writes attributes and hp derived from the chosen options", async () => {
    // The seven attribute columns were never written at all, so every
    // character took the schema default of 10 across the board — which is
    // why `statistics` showed identical sheets for every pairing.
    const prisma = makePrisma({});
    await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "Aelric",
      "room-spawn",
      { race: "dwarf", class: "mage" },
    );
    const data = (
      prisma.mudPlayer.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      }
    ).data;

    const expected = deriveCharacter([DWARF_MODS, MAGE_MODS]);
    expect(data.strength).toBe(expected.attributes.strength);
    expect(data.constitution).toBe(expected.attributes.constitution);
    expect(data.maxHp).toBe(expected.maxHp);
    // A fresh character starts at full health, whatever that works out to.
    expect(data.currentHp).toBe(data.maxHp);
    // Not the schema default that everyone used to get.
    expect(data.strength).not.toBe(10);
  });

  it("writes the chosen option ids in one statement with the player", async () => {
    const prisma = makePrisma({});
    await createPlayer(
      prisma as unknown as Parameters<typeof createPlayer>[0],
      "u-1",
      "Aelric",
      "room-spawn",
      { race: "dwarf", class: "mage" },
    );
    const createArgs = prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Nested-create, not a second statement: a crash between the two would
    // leave a character with no record of what it is.
    expect(createArgs.data.options).toEqual({
      create: [
        { groupId: "group-race", optionId: "option-dwarf" },
        { groupId: "group-class", optionId: "option-mage" },
      ],
    });
  });
});

describe("loadOrCreatePlayer", () => {
  it("returns the existing player row when one exists for the user", async () => {
    const player: MockPlayer = {
      id: "player-1",
      ownerId: "u-1",
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
    // The row is MAPPED, not returned raw: the option rows collapse to a
    // flat list in DECLARED ORDER, and the seven attribute columns move
    // under `attributes`, so a caller cannot reach a stat without going
    // through the shape both load paths share.
    expect(result).toEqual({
      id: player.id,
      ownerId: player.ownerId,
      name: player.name,
      roomId: player.roomId,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      experience: player.experience,
      level: player.level,
      ...EXPECTED_DEFAULTS,
    });
    expect(prisma.mudPlayer.create).not.toHaveBeenCalled();
  });

  it("creates a new player at the spawn room when none exists", async () => {
    const prisma = makePrisma({});
    const result = await loadOrCreatePlayer(
      prisma as unknown as Parameters<typeof loadOrCreatePlayer>[0],
      "u-1",
      "room-spawn",
    );
    expect(prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    expect(result.ownerId).toBe("u-1");
    expect(result.roomId).toBe("room-spawn");
    expect(result.currentHp).toBe(result.maxHp);
    expect(result.name).toMatch(/^Traveler-[a-f0-9]{8}$/);
  });

  it("throws when the seed hasn't run (a required axis with nothing on it)", async () => {
    const prisma = makePrisma({ noOptions: true });
    await expect(
      loadOrCreatePlayer(
        prisma as unknown as Parameters<typeof loadOrCreatePlayer>[0],
        "u-1",
        "room-spawn",
      ),
    ).rejects.toThrow(/no selectable option for required group/);
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
