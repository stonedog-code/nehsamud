/**
 * MUD smoke suite — end-to-end against a real HTTP sidecar + a real
 * WebSocket server with a hydrated WorldState. Exercises the five
 * "is the server actually working" guarantees that are easy to break
 * without a single test catching it:
 *
 *   1. Server up    — /health returns the canonical body; the WS
 *                     server accepts a TCP upgrade.
 *   2. User creation — first AUTH for a brand-new userId prompts for
 *                     a character name (no auto-spawn); a `create
 *                     <name>` message then creates the MudPlayer row.
 *                     A later AUTH for the same userId reuses the row.
 *   3. Movement     — `north` walks the player into the adjacent
 *                     room and auto-looks; session.currentRoomId
 *                     persists across the dispatch.
 *   4. Combat       — `attack <monster>` drops the hostile, awards
 *                     XP, and despawns the hostile from the room.
 *   5. Multi-user   — two clients on the same MudWsServer share the
 *                     same world (same hostile HP, same NPC catalog).
 *                     Each client has its own session, its own player
 *                     row, and its own AUTH userId — but they all
 *                     mutate the SAME world state.
 *
 * All tests use the in-memory WorldState — there is NO Postgres
 * dependency. Prisma is supplied as a stateful in-memory fake so the
 * persistence path (loadPlayer / createPlayer / savePlayerState) is
 * exercised end-to-end without a DB.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import WebSocket from "ws";

import { createHttpApp } from "../http-server.js";
import type {
  CachedHostile,
  CachedNpc,
  CachedRoom,
} from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";
import { createRng } from "../combat.js";
import { MudWsServer } from "../ws-server.js";
import {
  collectFrom,
  drainUntil,
  drainUntilSilent,
  parseMessages,
} from "./support/ws-drain.js";

// These tests are I/O bound on a socket, not CPU bound, and they run in the
// hopperguard monorepo alongside ~30 other jest projects. jest's 5s default
// is a wall-clock ceiling on a wait that is now condition-based, so it has
// to sit above the drain helpers' own failure cap or it fires first and
// throws away their diagnostic (NEH-924).
jest.setTimeout(30_000);

const SECRET = "mud-smoke-secret";
const AUDIENCE = "hopper-mud";

function token(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, aud: AUDIENCE, iat: now, exp: now + 60 },
    SECRET,
    { algorithm: "HS256" },
  );
}

/* ── world fixture ───────────────────────────────────────────────── */

const ROOM_SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "Cobbled square with a fountain.",
  exits: { north: "room-inn", south: "room-lower" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};
const ROOM_INN: CachedRoom = {
  id: "room-inn",
  enumKey: "TOWNSMEE_INN",
  name: "The Quiet Bed",
  description: "Warm fireplace.",
  exits: { south: "room-square" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};
const ROOM_LOWER: CachedRoom = {
  id: "room-lower",
  enumKey: "TOWNSMEE_LOWER_QUARTER",
  name: "Lower Quarter",
  description: "Run-down district.",
  exits: { north: "room-square" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};
const NPC_ZOFIA: CachedNpc = {
  id: "npc-zofia",
  slug: "zofia",
  name: "Zofia",
  description: "Innkeeper.",
  roomId: "room-inn",
  pronoun: "she",
  tags: ["good"],
  intelligenceMode: "canned",
  dialogLines: ["A room for the night?"],
  interests: ["lodging"],
};
const MON_GOBLIN: CachedHostile = {
  id: "hostile-goblin",
  slug: "goblin",
  name: "Goblin",
  description: "Wiry green creature.",
  level: 1,
  baseHp: 15, // 3 hits @ PLAYER_BASE_DAMAGE=5 to kill — exact and easy to assert.
  baseDamage: 1, // low enough that the player survives the full kill sequence.
  experience: 20,
  tags: ["humanoid", "evil"],
};

function buildWorld(): WorldState {
  // PVE — the smoke suite walks the full loop including combat.
  const w = new WorldState("pve");
  w.hydrate([ROOM_SQUARE, ROOM_INN, ROOM_LOWER], [NPC_ZOFIA], [MON_GOBLIN]);
  return w;
}

/* ── Prisma stand-in ──────────────────────────────────────────────
 *
 * Stateful fake — keeps an in-memory MudPlayer table keyed by userId
 * so the second-AUTH-for-the-same-userId path actually returns the
 * previously-created row. Tracks call counts on each method so the
 * tests can assert on the persistence touchpoints.
 */
interface FakePlayerRow {
  id: string;
  ownerId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
  options: Array<{
    group: { key: string; name: string; position: number };
    option: { slug: string; name: string };
  }>;
}

/** The two axes this fake world declares, and what is on each. */
const FAKE_GROUPS = [
  {
    id: "group-race",
    key: "race",
    name: "Race",
    description: "",
    required: true,
    position: 0,
    options: [
      { slug: "dwarf", name: "Dwarf", description: "" },
      { slug: "human", name: "Human", description: "" },
    ],
  },
  {
    id: "group-class",
    key: "class",
    name: "Class",
    description: "",
    required: true,
    position: 1,
    options: [
      { slug: "mage", name: "Mage", description: "" },
      { slug: "warrior", name: "Warrior", description: "" },
    ],
  },
];

interface FakePrisma {
  mudPlayer: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  mudCharacterOptionGroup: { findMany: jest.Mock };
  mudCharacterOption: { findUnique: jest.Mock };
  /** Table of rows for test assertions. */
  _rows: Map<string, FakePlayerRow>;
}

function fakePrisma(): FakePrisma {
  const rows = new Map<string, FakePlayerRow>();
  let nextId = 1;
  const findFirst = jest.fn(async (args: { where: { ownerId: string } }) => {
    return rows.get(args.where.ownerId) ?? null;
  });
  const create = jest.fn(
    async (args: { data: Record<string, unknown> }) => {
      const row: FakePlayerRow = {
        id: `player-${nextId++}`,
        ownerId: args.data.ownerId as string,
        name: args.data.name as string,
        roomId: args.data.roomId as string | null,
        currentHp: args.data.currentHp as number,
        maxHp: args.data.maxHp as number,
        experience: args.data.experience as number,
        level: 1,
      // The relations and attribute columns `loadPlayer` unpacks. Without
      // them the mapper throws a TypeError from inside persistence and the
      // socket simply never answers, which is why this fake carries them.
      strength: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      constitution: 10,
      dexterity: 10,
      luck: 10,
      options: [
        {
          group: { key: "race", name: "Race", position: 0 },
          option: { slug: "human", name: "Human" },
        },
        {
          group: { key: "class", name: "Class", position: 1 },
          option: { slug: "warrior", name: "Warrior" },
        },
      ],
      };
      rows.set(row.ownerId, row);
      return row;
    },
  );
  const update = jest.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      for (const row of rows.values()) {
        if (row.id === args.where.id) {
          if (typeof args.data.roomId === "string") row.roomId = args.data.roomId;
          if (typeof args.data.currentHp === "number")
            row.currentHp = args.data.currentHp;
          if (typeof args.data.maxHp === "number") row.maxHp = args.data.maxHp;
          if (typeof args.data.experience === "number")
            row.experience = args.data.experience;
          // Mirrors savePlayerState writing the derived level. Without this
          // the fake would happily report XP surviving a reconnect while the
          // level column silently never moved — the fake agreeing with a bug
          // the real client would not have.
          if (typeof args.data.level === "number") row.level = args.data.level;
          return row;
        }
      }
      return null;
    },
  );
  return {
    mudPlayer: { findFirst, create, update },
    mudCharacterOptionGroup: {
      findMany: jest.fn(async () => FAKE_GROUPS),
    },
    mudCharacterOption: {
      findUnique: jest.fn(
        async (args: {
          where: { groupId_slug: { groupId: string; slug: string } };
        }) => {
          const { groupId, slug } = args.where.groupId_slug;
          const group = FAKE_GROUPS.find((g) => g.id === groupId);
          const option = group?.options.find((o) => o.slug === slug);
          return option
            ? {
                id: `option-${slug}`,
                slug,
                selectable: true,
                strengthMod: 0,
                intelligenceMod: 0,
                wisdomMod: 0,
                charismaMod: 0,
                constitutionMod: 0,
                dexterityMod: 0,
                luckMod: 0,
              }
            : null;
        },
      ),
    },
    _rows: rows,
  };
}

/* ── boot helpers ────────────────────────────────────────────────── */

interface Booted {
  url: string;
  world: WorldState;
  prisma: FakePrisma;
  server: MudWsServer;
  close(): Promise<void>;
}

async function bootWsOnly(world: WorldState, prisma?: FakePrisma): Promise<Booted> {
  const http = createServer();
  const fake = prisma ?? fakePrisma();
  // Cast through unknown: FakePrisma implements the slice of the
  // PrismaClient surface that the server actually touches.
  const server = new MudWsServer({
    server: http,
    world,
    prisma: fake as unknown as ConstructorParameters<typeof MudWsServer>[0]["prisma"],
    // Seeded so combat is reproducible. Without this every roll comes from
    // the clock, and a smoke suite that asserts damage would be asserting
    // whatever today's numbers happened to be.
    rng: createRng(20260813),
  });
  await new Promise<void>((resolve, reject) => {
    http.listen(0, "127.0.0.1", () => resolve());
    http.on("error", reject);
  });
  const addr = http.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    world,
    prisma: fake,
    server,
    close: async () => {
      await server.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

async function openClient(url: string): Promise<WebSocket> {
  const client = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  return client;
}

/**
 * Drive a brand-new connection through the full entry handshake:
 * AUTH, then `create <name>` to seed the character. Leaves the
 * socket at the spawn room with an open session, ready for gameplay
 * commands. Drains the server frames at each step so the caller
 * starts from a quiet socket.
 */
/**
 * Authenticate, then walk the three-step creation flow: name, race, class.
 *
 * Creation stopped being a single message when the race and class stopped
 * being defaulted — the server now asks, because picking the
 * alphabetically-first playable row for everyone is exactly the bug that
 * made every character in the database identical.
 */
async function authAndCreate(
  sock: WebSocket,
  userId: string,
  name = `Hero-${userId}`,
  race = "dwarf",
  characterClass = "mage",
): Promise<void> {
  // Each step waits for the prompt it asked for rather than for the socket
  // to fall quiet. A half-finished creation is what every downstream
  // movement/combat test inherits, so this helper is where a lost reply
  // does the most damage (NEH-924).
  sock.send(JSON.stringify({ type: "AUTH", token: token(userId) }));
  await drainUntil(sock, (m) => m.some((l) => l.includes("don't have a character")), {
    label: "the no-character prompt",
  });
  sock.send(
    JSON.stringify({ type: "CLIENT_MESSAGE", message: `create ${name}` }),
  );
  await drainUntil(sock, (m) => m.some((l) => l.includes("Choose a race")), {
    label: "the race prompt",
  });
  sock.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: race }));
  await drainUntil(sock, (m) => m.some((l) => l.includes("choose a class")), {
    label: "the class prompt",
  });
  sock.send(
    JSON.stringify({ type: "CLIENT_MESSAGE", message: characterClass }),
  );
  await drainUntil(sock, (m) => m.some((l) => l === ROOM_SQUARE.name), {
    label: "the spawn-room render",
  });
}

/* ── shared setup ─────────────────────────────────────────────────── */

let booted: Booted;
beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;
  const world = buildWorld();
  // Spawn the goblin in the lower quarter so the combat tests can
  // walk a player into it without disturbing the spawn-room renders
  // the other tests rely on.
  world.spawnHostile("goblin", ROOM_LOWER.id);
  booted = await bootWsOnly(world);
});
afterEach(async () => {
  await booted.close();
  delete process.env.JWT_SECRET;
});

/* ── 1. Server up ─────────────────────────────────────────────────── */

describe("smoke / 1: server is up", () => {
  it("/health returns the canonical {status:'healthy', service:'ok'} body", async () => {
    const app = createHttpApp({
      snapshot: () => ({
        service: "mud",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 0,
        connections: 0,
        queueToWorld: null,
        queueToClients: null,
      }),
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "healthy", service: "ok" });
    } finally {
      server.close();
    }
  });

  it("the WebSocket server accepts a TCP upgrade", async () => {
    const client = await openClient(booted.url);
    expect(client.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});

/* ── 2. User creation ─────────────────────────────────────────────── */

describe("smoke / 2: user creation on AUTH", () => {
  it("first AUTH for a brand-new userId prompts for a name without auto-spawning", async () => {
    const client = await openClient(booted.url);
    client.send(JSON.stringify({ type: "AUTH", token: token("user-alpha") }));
    const lines = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l.includes("don't have a character")), {
        label: "the no-character prompt",
      }),
    );

    // No character row should exist yet — the server waits for the
    // explicit `create <name>` message.
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("don't have a character"))).toBe(true);
    expect(lines.some((l) => l.includes("create"))).toBe(true);

    client.close();
  });

  it("the creation flow asks for a name, a race and a class, then creates the row", async () => {
    const client = await openClient(booted.url);
    client.send(JSON.stringify({ type: "AUTH", token: token("user-alpha2") }));
    await drainUntil(client, (m) => m.some((l) => l.includes("don't have a character")), {
      label: "the no-character prompt",
    });

    // Name.
    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Aelric" }),
    );
    const afterName = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l.includes("Choose a race")), {
        label: "the race prompt",
      }),
    );
    expect(afterName.some((l) => l.includes("Choose a race"))).toBe(true);
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();

    // Race.
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "dwarf" }));
    const afterRace = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l.includes("choose a class")), {
        label: "the class prompt",
      }),
    );
    expect(afterRace.some((l) => l.includes("choose a class"))).toBe(true);
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();

    // Class — and only now does the row appear.
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "mage" }));
    const lines = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l === ROOM_SQUARE.name), {
        label: "the spawn-room render",
      }),
    );

    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    const createArgs = booted.prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.ownerId).toBe("user-alpha2");
    expect(createArgs.data.name).toBe("Aelric");
    expect(createArgs.data.roomId).toBe(ROOM_SQUARE.id);
    // The whole point: what the player picked is what gets written. Before
    // this, both ids were whatever came first alphabetically.
    expect(createArgs.data.options).toEqual({
      create: [
        { groupId: "group-race", optionId: "option-dwarf" },
        { groupId: "group-class", optionId: "option-mage" },
      ],
    });

    // The character lands at the spawn and auto-looks the town square.
    expect(lines.some((l) => l.includes("Aelric"))).toBe(true);
    expect(lines.some((l) => l === ROOM_SQUARE.name)).toBe(true);

    client.close();
  });

  it("creates from a single CREATE_CHARACTER frame, for a client that already knows", async () => {
    const client = await openClient(booted.url);
    client.send(JSON.stringify({ type: "AUTH", token: token("user-frame") }));
    await drainUntil(client, (m) => m.some((l) => l.includes("don't have a character")), {
      label: "the no-character prompt",
    });

    client.send(
      JSON.stringify({
        type: "CREATE_CHARACTER",
        name: "Bryn",
        options: { race: "human", class: "warrior" },
      }),
    );
    const lines = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l === ROOM_SQUARE.name), {
        label: "the spawn-room render",
      }),
    );

    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    const createArgs = booted.prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.name).toBe("Bryn");
    expect(createArgs.data.options).toEqual({
      create: [
        { groupId: "group-race", optionId: "option-human" },
        { groupId: "group-class", optionId: "option-warrior" },
      ],
    });
    expect(lines.some((l) => l === ROOM_SQUARE.name)).toBe(true);

    client.close();
  });

  it("refuses a race it does not have, and lets the player try again", async () => {
    // A silent fallback to some default is exactly the bug being fixed, so
    // the refusal has to be observable.
    const client = await openClient(booted.url);
    client.send(JSON.stringify({ type: "AUTH", token: token("user-badrace") }));
    await drainUntil(client, (m) => m.some((l) => l.includes("don't have a character")), {
      label: "the no-character prompt",
    });
    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Corin" }),
    );
    await drainUntil(client, (m) => m.some((l) => l.includes("Choose a race")), {
      label: "the race prompt",
    });

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "wombat" }));
    const rejected = parseMessages(
      await drainUntil(
        client,
        (m) => m.some((l) => l.includes("isn't one of the race choices")),
        { label: "the bad-race refusal" },
      ),
    );
    expect(
      rejected.some((l) => l.includes("isn't one of the race choices")),
    ).toBe(true);
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "dwarf" }));
    await drainUntil(client, (m) => m.some((l) => l.includes("choose a class")), {
      label: "the class prompt",
    });
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "mage" }));
    await drainUntil(client, (m) => m.some((l) => l === ROOM_SQUARE.name), {
      label: "the spawn-room render",
    });
    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);

    client.close();
  });

  it("second AUTH for the SAME userId reuses the existing row (no second create)", async () => {
    const first = await openClient(booted.url);
    await authAndCreate(first, "user-beta", "Beatrix");
    first.close();
    // Give the close handler a tick to run before reconnecting.
    await new Promise((r) => setTimeout(r, 20));

    booted.prisma.mudPlayer.create.mockClear();
    booted.prisma.mudPlayer.findFirst.mockClear();

    const second = await openClient(booted.url);
    second.send(JSON.stringify({ type: "AUTH", token: token("user-beta") }));
    await drainUntilSilent(second);

    expect(booted.prisma.mudPlayer.findFirst).toHaveBeenCalled();
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();
    second.close();
  });
});

/* ── 3. Movement ──────────────────────────────────────────────────── */

describe("smoke / 3: movement", () => {
  it("`north` from the spawn room walks the player into the inn and auto-looks", async () => {
    const client = await openClient(booted.url);
    await authAndCreate(client, "user-gamma");

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "north" }));
    const lines = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l === ROOM_INN.name), {
        label: "the inn's auto-look",
      }),
    );

    // The auto-look of the inn must surface at minimum the room name
    // and one of its distinguishing features (the NPC Zofia).
    expect(lines.some((l) => l === ROOM_INN.name)).toBe(true);
    expect(lines.some((l) => l.includes("Zofia"))).toBe(true);
    client.close();
  });

  it("an unknown direction does not move the player", async () => {
    const client = await openClient(booted.url);
    await authAndCreate(client, "user-delta");

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "up" }));
    // A negative assertion, so there is nothing to wait FOR — but
    // `drainUntilSilent` does not return until the refusal has actually
    // arrived, which is what keeps the check below from passing vacuously
    // on an empty set.
    const lines = parseMessages(await drainUntilSilent(client));
    // The exact wording is owned by the move handler — assert only
    // that we did NOT auto-look into the inn (i.e. the move was
    // rejected). The square has no `up` exit.
    expect(lines.some((l) => l === ROOM_INN.name)).toBe(false);
    client.close();
  });
});

/* ── 4. Combat ────────────────────────────────────────────────────── */

describe("smoke / 4: combat", () => {
  it("attacking a goblin three times kills it, awards XP, and despawns it", async () => {
    const client = await openClient(booted.url);
    await authAndCreate(client, "user-epsilon");

    // Walk south into the goblin's room.
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    const arrival = parseMessages(
      await drainUntil(client, (m) => m.some((l) => l === ROOM_LOWER.name), {
        label: "the lower quarter's auto-look",
      }),
    );
    expect(arrival.some((l) => l === ROOM_LOWER.name)).toBe(true);
    expect(arrival.some((l) => l.includes("Goblin"))).toBe(true);
    expect(booted.world.liveHostileCount()).toBe(1);

    // Three swings @ PLAYER_BASE_DAMAGE=5 against baseHp=15 kills.
    for (let i = 0; i < 3; i += 1) {
      client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
      // The third swing kills, so what closes the round differs — wait for
      // whichever line this iteration is about to assert on.
      const closes = i < 2 ? "HP left" : "20 XP";
      const swing = parseMessages(
        await drainUntil(client, (m) => m.some((l) => l.includes(closes)), {
          label: `the swing reporting "${closes}"`,
        }),
      );
      if (i < 2) {
        expect(swing.some((l) => l.includes("strike"))).toBe(true);
        expect(swing.some((l) => l.includes("HP left"))).toBe(true);
      } else {
        expect(swing.some((l) => l.includes("falls"))).toBe(true);
        expect(swing.some((l) => l.includes("20 XP"))).toBe(true);
      }
    }

    // Hostile despawned.
    expect(booted.world.liveHostileCount()).toBe(0);

    // Player row carries the XP gain.
    const row = booted.prisma._rows.get("user-epsilon");
    expect(row?.experience).toBe(20);

    client.close();
  });

  it("experience survives a disconnect and reconnect", async () => {
    // The failure this whole feature exists to remove: experience used to be
    // session-only, so every reconnect silently reset a character to zero and
    // level 100 was unreachable by construction. Asserting the row is not
    // enough — the point is what the NEXT session starts with.
    const first = await openClient(booted.url);
    await authAndCreate(first, "user-persist");

    first.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    await drainUntil(first, (m) => m.some((l) => l === ROOM_LOWER.name), {
      label: "the lower quarter's auto-look",
    });
    for (let i = 0; i < 3; i += 1) {
      first.send(
        JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }),
      );
      const closes = i < 2 ? "HP left" : "20 XP";
      await drainUntil(first, (m) => m.some((l) => l.includes(closes)), {
        label: `the swing reporting "${closes}"`,
      });
    }

    const afterKill = booted.prisma._rows.get("user-persist");
    expect(afterKill?.experience).toBe(20);

    // Drop the socket entirely, then come back as the same user.
    first.close();
    await new Promise((r) => setTimeout(r, 50));

    const second = await openClient(booted.url);
    second.send(JSON.stringify({ type: "AUTH", token: token("user-persist") }));
    await drainUntilSilent(second);

    // `statistics` does not exist yet (NEH-625), so the durable evidence is
    // the row the new session loaded from and wrote back — it would be reset
    // to 0 if the session had started blank and then saved over it.
    second.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "look" }));
    await drainUntilSilent(second);

    const afterReconnect = booted.prisma._rows.get("user-persist");
    expect(afterReconnect?.experience).toBe(20);
    expect(afterReconnect?.level).toBe(1);

    second.close();
  });
});

/* ── 5. Multiple users share world state ─────────────────────────── */

describe("smoke / 5: multiple users share world state", () => {
  it("two clients attacking the same hostile see the cumulative damage", async () => {
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    await Promise.all([
      authAndCreate(userA, "user-A"),
      authAndCreate(userB, "user-B"),
    ]);

    // Both walk into the goblin's room.
    userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    userB.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    const arrived = (m: string[]): boolean => m.some((l) => l === ROOM_LOWER.name);
    await Promise.all([
      drainUntil(userA, arrived, { label: "A's arrival render" }),
      drainUntil(userB, arrived, { label: "B's arrival render" }),
    ]);

    // Damage varies and a blow can miss, so the exact numbers this used to
    // assert are no longer the point — and pinning them would assert the
    // ABSENCE of variable combat. What must hold is the shared-world
    // invariant: B's swing sees A's damage, never a fresh hostile.
    const remainingHp = (lines: string[]): number | undefined => {
      for (const line of lines) {
        const m = /has (\d+)\/(\d+) HP left/.exec(line);
        if (m) return Number(m[1]);
      }
      return undefined;
    };

    // A swing ends either with the hostile's remaining HP or with it falling;
    // wait for whichever came, never for the clock.
    const swingResolved = (m: string[]): boolean =>
      m.some((l) => /HP left/.test(l) || l.includes("falls"));

    // A swings until it actually lands, so the comparison below is meaningful
    // rather than trivially true on a miss.
    let aHp: number | undefined;
    for (let i = 0; i < 20 && (aHp === undefined || aHp === MON_GOBLIN.baseHp); i += 1) {
      userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
      aHp = remainingHp(
        parseMessages(await drainUntil(userA, swingResolved, { label: "A's swing" })),
      );
      if (aHp === undefined) break; // it died — covered by the combat test
    }
    expect(aHp).toBeDefined();
    expect(aHp!).toBeLessThan(MON_GOBLIN.baseHp);

    userB.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
    const bHp = remainingHp(
      parseMessages(await drainUntil(userB, swingResolved, { label: "B's swing" })),
    );

    // B either sees the hostile at or below where A left it, or kills it.
    // What it must never see is the hostile back at full health.
    if (bHp !== undefined) {
      expect(bHp).toBeLessThanOrEqual(aHp!);
      expect(bHp).toBeLessThan(MON_GOBLIN.baseHp);
    }

    // Both players have their own session/player row.
    expect(booted.prisma._rows.has("user-A")).toBe(true);
    expect(booted.prisma._rows.has("user-B")).toBe(true);
    expect(booted.prisma._rows.get("user-A")?.id).not.toBe(
      booted.prisma._rows.get("user-B")?.id,
    );

    userA.close();
    userB.close();
  });

  it("the server's summary() reports both authenticated connections", async () => {
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    await Promise.all([
      authAndCreate(userA, "user-C"),
      authAndCreate(userB, "user-D"),
    ]);

    // summary() is what /metrics reads in production. Two AUTH-OK
    // clients on the same server must both appear in `authenticated`.
    const summary = booted.server.summary();
    expect(summary.authenticated).toBe(2);
    expect(booted.prisma._rows.size).toBe(2);

    userA.close();
    userB.close();
  });
});

/* ── 6. Players can talk to each other ───────────────────────────── */

describe("smoke / 6: communication reaches other sockets", () => {
  it("say is heard by the room and not by the speaker twice", async () => {
    // The delivery half of `say`. A unit test can assert that a handler
    // RETURNS a broadcast; only this can show it arriving on someone else's
    // socket, which is the part that makes "multi-user" true.
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    await authAndCreate(userA, "user-say-a", "Aria");
    await authAndCreate(userB, "user-say-b", "Bran");

    const fromB = collectFrom(userB);
    userA.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "say hello there" }),
    );
    const heardByA = parseMessages(
      await drainUntil(userA, (m) => m.some((l) => l === 'You say "hello there"'), {
        label: "A's own echo",
      }),
    );
    const heardByB = parseMessages(
      await fromB.until((m) => m.some((l) => l === 'Aria says "hello there"'), {
        label: "the say broadcast on B",
      }),
    );
    fromB.stop();

    expect(heardByA.some((l) => l === 'You say "hello there"')).toBe(true);
    // The speaker must not also receive the third-person form.
    expect(heardByA.some((l) => l.includes("Aria says"))).toBe(false);
    expect(heardByB.some((l) => l === 'Aria says "hello there"')).toBe(true);

    userA.close();
    userB.close();
  });

  it("a player in another room does not hear a say", async () => {
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    await authAndCreate(userA, "user-say-c", "Cass");
    await authAndCreate(userB, "user-say-d", "Dell");

    // Move B out of the square before A speaks.
    userB.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "north" }));
    await drainUntil(userB, (m) => m.some((l) => l === ROOM_INN.name), {
      label: "B's move into the inn",
    });

    const fromB = collectFrom(userB);
    userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "say private" }));
    // Waiting for A's own echo is the positive control: the broadcast has
    // demonstrably been dispatched by the time B's frames are read, so B
    // having heard nothing means something.
    await drainUntil(userA, (m) => m.some((l) => l.includes("private")), {
      label: "A's own echo",
    });
    const heardByB = parseMessages(fromB.stop());

    expect(heardByB.some((l) => l.includes("private"))).toBe(false);

    userA.close();
    userB.close();
  });

  it("whisper reaches only its target", async () => {
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    const userC = await openClient(booted.url);
    await authAndCreate(userA, "user-w-a", "Eve");
    await authAndCreate(userB, "user-w-b", "Finn");
    await authAndCreate(userC, "user-w-c", "Gwen");

    const fromB = collectFrom(userB);
    const fromC = collectFrom(userC);
    userA.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "whisper Finn psst" }),
    );
    const heardByB = parseMessages(
      await fromB.until((m) => m.some((l) => l.includes('whispers "psst" to you')), {
        label: "the whisper on its target",
      }),
    );
    fromB.stop();
    // C is read only after B has demonstrably received it, so "C heard
    // nothing" is a fact about routing rather than about timing.
    const heardByC = parseMessages(fromC.stop());

    expect(heardByB.some((l) => l.includes('whispers "psst" to you'))).toBe(true);
    expect(heardByC.some((l) => l.includes("psst"))).toBe(false);

    userA.close();
    userB.close();
    userC.close();
  });
});
