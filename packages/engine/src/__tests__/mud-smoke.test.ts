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
 *   4. Combat       — `attack <monster>` drops the monster, awards
 *                     XP, and despawns the monster from the room.
 *   5. Multi-user   — two clients on the same MudWsServer share the
 *                     same world (same monster HP, same NPC catalog).
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
  CachedMonster,
  CachedNpc,
  CachedRoom,
} from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";
import { createRng } from "../combat.js";
import { MudWsServer } from "../ws-server.js";

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
  imageName: null,
};
const ROOM_INN: CachedRoom = {
  id: "room-inn",
  enumKey: "TOWNSMEE_INN",
  name: "The Quiet Bed",
  description: "Warm fireplace.",
  exits: { south: "room-square" },
  environment: "townsmee",
  imageName: null,
};
const ROOM_LOWER: CachedRoom = {
  id: "room-lower",
  enumKey: "TOWNSMEE_LOWER_QUARTER",
  name: "Lower Quarter",
  description: "Run-down district.",
  exits: { north: "room-square" },
  environment: "townsmee",
  imageName: null,
};
const NPC_ZOFIA: CachedNpc = {
  id: "npc-zofia",
  slug: "zofia",
  name: "Zofia",
  description: "Innkeeper.",
  roomId: "room-inn",
  pronoun: "she",
  alignment: "good",
  intelligenceMode: "canned",
  dialogLines: ["A room for the night?"],
  interests: ["lodging"],
};
const MON_GOBLIN: CachedMonster = {
  id: "monster-goblin",
  slug: "goblin",
  name: "Goblin",
  description: "Wiry green creature.",
  level: 1,
  baseHp: 15, // 3 hits @ PLAYER_BASE_DAMAGE=5 to kill — exact and easy to assert.
  baseDamage: 1, // low enough that the player survives the full kill sequence.
  experience: 20,
  alignment: "evil",
  mobType: "humanoid",
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
  userId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
}

interface FakePrisma {
  mudPlayer: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  mudRace: { findFirst: jest.Mock };
  mudClass: { findFirst: jest.Mock };
  /** Table of rows for test assertions. */
  _rows: Map<string, FakePlayerRow>;
}

function fakePrisma(): FakePrisma {
  const rows = new Map<string, FakePlayerRow>();
  let nextId = 1;
  const findFirst = jest.fn(async (args: { where: { userId: string } }) => {
    return rows.get(args.where.userId) ?? null;
  });
  const create = jest.fn(
    async (args: { data: Record<string, unknown> }) => {
      const row: FakePlayerRow = {
        id: `player-${nextId++}`,
        userId: args.data.userId as string,
        name: args.data.name as string,
        roomId: args.data.roomId as string | null,
        currentHp: args.data.currentHp as number,
        maxHp: args.data.maxHp as number,
        experience: args.data.experience as number,
        level: 1,
      };
      rows.set(row.userId, row);
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
    mudRace: { findFirst: jest.fn(async () => ({ id: "race-human" })) },
    mudClass: { findFirst: jest.fn(async () => ({ id: "class-fighter" })) },
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
async function authAndCreate(
  sock: WebSocket,
  userId: string,
  name = `Hero-${userId}`,
): Promise<void> {
  sock.send(JSON.stringify({ type: "AUTH", token: token(userId) }));
  await drainUntilSilent(sock);
  sock.send(
    JSON.stringify({ type: "CLIENT_MESSAGE", message: `create ${name}` }),
  );
  await drainUntilSilent(sock);
}

/**
 * Drain incoming frames until no message arrives for `idleMs`.
 * Robust against varying line counts (combat outcomes shift between
 * 3 and 5 SERVER_MESSAGE lines depending on whether the swing kills
 * the monster, lands a counter-attack, etc.).
 */
function drainUntilSilent(sock: WebSocket, idleMs = 50): Promise<string[]> {
  return new Promise((resolve) => {
    const frames: string[] = [];
    let timer: NodeJS.Timeout | undefined;
    const reset = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sock.off("message", onMsg);
        resolve(frames);
      }, idleMs);
    };
    const onMsg = (raw: WebSocket.RawData): void => {
      frames.push(raw.toString());
      reset();
    };
    sock.on("message", onMsg);
    reset();
  });
}

/**
 * Start recording frames NOW, and return a stop-and-read function.
 *
 * `drainUntilSilent` cannot observe a broadcast caused by SOMEONE ELSE's
 * command: by the time the speaker's own drain has gone idle and we attach a
 * listener to the listener's socket, their frame has already arrived and been
 * dropped — `ws` does not buffer for a listener attached later. Every
 * "B heard it" assertion silently read an empty array, and every "B did NOT
 * hear it" assertion passed vacuously, which is the worse half: those tests
 * would still be green with the broadcast wired to the wrong room.
 *
 * So a recipient's collector must be attached BEFORE the speaker sends.
 */
function collectFrom(sock: WebSocket): () => string[] {
  const frames: string[] = [];
  const onMsg = (raw: WebSocket.RawData): void => {
    frames.push(raw.toString());
  };
  sock.on("message", onMsg);
  return () => {
    sock.off("message", onMsg);
    return frames;
  };
}

function parseMessages(frames: string[]): string[] {
  return frames
    .map((f) => JSON.parse(f) as { type: string; message?: string })
    .filter((p) => p.type === "SERVER_MESSAGE")
    .map((p) => p.message ?? "");
}

/* ── shared setup ─────────────────────────────────────────────────── */

let booted: Booted;
beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;
  const world = buildWorld();
  // Spawn the goblin in the lower quarter so the combat tests can
  // walk a player into it without disturbing the spawn-room renders
  // the other tests rely on.
  world.spawnMonster("goblin", ROOM_LOWER.id);
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
    const lines = parseMessages(await drainUntilSilent(client));

    // No character row should exist yet — the server waits for the
    // explicit `create <name>` message.
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("don't have a character"))).toBe(true);
    expect(lines.some((l) => l.includes("create"))).toBe(true);

    client.close();
  });

  it("a `create <name>` message creates the MudPlayer row at the spawn and auto-looks", async () => {
    const client = await openClient(booted.url);
    client.send(JSON.stringify({ type: "AUTH", token: token("user-alpha2") }));
    await drainUntilSilent(client);

    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Aelric" }),
    );
    const lines = parseMessages(await drainUntilSilent(client));

    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    const createArgs = booted.prisma.mudPlayer.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.userId).toBe("user-alpha2");
    expect(createArgs.data.name).toBe("Aelric");
    expect(createArgs.data.roomId).toBe(ROOM_SQUARE.id);

    // The character lands at the spawn and auto-looks the town square.
    expect(lines.some((l) => l.includes("Aelric"))).toBe(true);
    expect(lines.some((l) => l === ROOM_SQUARE.name)).toBe(true);

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
    const lines = parseMessages(await drainUntilSilent(client));

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
    const arrival = parseMessages(await drainUntilSilent(client));
    expect(arrival.some((l) => l === ROOM_LOWER.name)).toBe(true);
    expect(arrival.some((l) => l.includes("Goblin"))).toBe(true);
    expect(booted.world.liveMonsterCount()).toBe(1);

    // Three swings @ PLAYER_BASE_DAMAGE=5 against baseHp=15 kills.
    for (let i = 0; i < 3; i += 1) {
      client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
      const swing = parseMessages(await drainUntilSilent(client));
      if (i < 2) {
        expect(swing.some((l) => l.includes("strike"))).toBe(true);
        expect(swing.some((l) => l.includes("HP left"))).toBe(true);
      } else {
        expect(swing.some((l) => l.includes("falls"))).toBe(true);
        expect(swing.some((l) => l.includes("20 XP"))).toBe(true);
      }
    }

    // Monster despawned.
    expect(booted.world.liveMonsterCount()).toBe(0);

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
    await drainUntilSilent(first);
    for (let i = 0; i < 3; i += 1) {
      first.send(
        JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }),
      );
      await drainUntilSilent(first);
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
  it("two clients attacking the same monster see the cumulative damage", async () => {
    const userA = await openClient(booted.url);
    const userB = await openClient(booted.url);
    await Promise.all([
      authAndCreate(userA, "user-A"),
      authAndCreate(userB, "user-B"),
    ]);

    // Both walk into the goblin's room.
    userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    userB.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "south" }));
    await Promise.all([drainUntilSilent(userA), drainUntilSilent(userB)]);

    // Damage varies and a blow can miss, so the exact numbers this used to
    // assert are no longer the point — and pinning them would assert the
    // ABSENCE of variable combat. What must hold is the shared-world
    // invariant: B's swing sees A's damage, never a fresh monster.
    const remainingHp = (lines: string[]): number | undefined => {
      for (const line of lines) {
        const m = /has (\d+)\/(\d+) HP left/.exec(line);
        if (m) return Number(m[1]);
      }
      return undefined;
    };

    // A swings until it actually lands, so the comparison below is meaningful
    // rather than trivially true on a miss.
    let aHp: number | undefined;
    for (let i = 0; i < 20 && (aHp === undefined || aHp === MON_GOBLIN.baseHp); i += 1) {
      userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
      aHp = remainingHp(parseMessages(await drainUntilSilent(userA)));
      if (aHp === undefined) break; // it died — covered by the combat test
    }
    expect(aHp).toBeDefined();
    expect(aHp!).toBeLessThan(MON_GOBLIN.baseHp);

    userB.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "attack goblin" }));
    const bHp = remainingHp(parseMessages(await drainUntilSilent(userB)));

    // B either sees the monster at or below where A left it, or kills it.
    // What it must never see is the monster back at full health.
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

    const stopB = collectFrom(userB);
    userA.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "say hello there" }),
    );
    const heardByA = parseMessages(await drainUntilSilent(userA));
    const heardByB = parseMessages(stopB());

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
    await drainUntilSilent(userB);

    const stopB = collectFrom(userB);
    userA.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "say private" }));
    await drainUntilSilent(userA);
    const heardByB = parseMessages(stopB());

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

    const stopB = collectFrom(userB);
    const stopC = collectFrom(userC);
    userA.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "whisper Finn psst" }),
    );
    await drainUntilSilent(userA);
    const heardByB = parseMessages(stopB());
    const heardByC = parseMessages(stopC());

    expect(heardByB.some((l) => l.includes('whispers "psst" to you'))).toBe(true);
    expect(heardByC.some((l) => l.includes("psst"))).toBe(false);

    userA.close();
    userB.close();
    userC.close();
  });
});
