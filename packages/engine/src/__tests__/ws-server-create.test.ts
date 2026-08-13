/**
 * Character-creation flow over a real WebSocket connection.
 *
 * When a Prisma layer IS present and the authenticated user has no
 * MudPlayer row yet, the server does NOT auto-spawn a character —
 * it prompts the client and parses the next CLIENT_MESSAGE as
 * `create <name>` (handled by `handleCreatePlayer`). These tests
 * pin that prompt + every error branch of the creation handler:
 *
 *   - first AUTH for a new user prompts instead of auto-spawning
 *   - `create <name>` seeds the row at the spawn and auto-looks
 *   - a bare `<name>` (no `create` verb) is accepted too
 *   - a blank name is rejected and the socket can retry
 *   - a unique-constraint violation surfaces "name is taken"
 *   - any other create failure surfaces the underlying message
 *
 * No Postgres — Prisma is a configurable in-memory fake so the
 * createPlayer path is exercised end-to-end without a DB.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import WebSocket from "ws";

import type { CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";
import { MudWsServer } from "../ws-server.js";

const SECRET = "ws-create-secret";
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
  exits: {},
  environment: "townsmee",
  imageName: null,
};

function buildWorld(): WorldState {
  const w = new WorldState();
  w.hydrate([ROOM_SQUARE], [], []);
  return w;
}

/* ── configurable Prisma fake ─────────────────────────────────────
 *
 * `createImpl` lets a test override the create() behavior so the
 * unique-constraint + generic-failure branches can be exercised.
 * The default impl mirrors a real insert: assigns an id and stores
 * the row keyed by userId.
 */
interface FakeRow {
  id: string;
  userId: string;
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
  race: { name: string };
  class: { name: string };
}

function fakePrisma(
  createImpl?: (data: Record<string, unknown>) => Promise<FakeRow>,
) {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => {
    if (createImpl) return createImpl(args.data);
    const row: FakeRow = {
      id: `player-${nextId++}`,
      userId: args.data.userId as string,
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
      race: { name: "Human" },
      class: { name: "Fighter" },
    };
    rows.set(row.userId, row);
    return row;
  });
  return {
    mudPlayer: {
      findFirst: jest.fn(async (args: { where: { userId: string } }) =>
        rows.get(args.where.userId) ?? null,
      ),
      create,
      update: jest.fn(async () => undefined),
    },
    mudRace: { findFirst: jest.fn(async () => ({ id: "race-human" })) },
    mudClass: { findFirst: jest.fn(async () => ({ id: "class-fighter" })) },
    _rows: rows,
  };
}

type FakePrisma = ReturnType<typeof fakePrisma>;

/* ── boot helpers ────────────────────────────────────────────────── */

interface Booted {
  url: string;
  prisma: FakePrisma;
  close(): Promise<void>;
}

async function boot(prisma: FakePrisma): Promise<Booted> {
  const http = createServer();
  const server = new MudWsServer({
    server: http,
    world: buildWorld(),
    prisma: prisma as unknown as ConstructorParameters<
      typeof MudWsServer
    >[0]["prisma"],
  });
  await new Promise<void>((resolve, reject) => {
    http.listen(0, "127.0.0.1", () => resolve());
    http.on("error", reject);
  });
  const addr = http.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    prisma,
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

/** Drain incoming frames until the socket is quiet for `idleMs`. */
function drainUntilSilent(sock: WebSocket, idleMs = 60): Promise<string[]> {
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

function messages(frames: string[]): string[] {
  return frames
    .map((f) => JSON.parse(f) as { type: string; message?: string })
    .filter((p) => p.type === "SERVER_MESSAGE")
    .map((p) => p.message ?? "");
}

async function authNew(sock: WebSocket, userId: string): Promise<string[]> {
  sock.send(JSON.stringify({ type: "AUTH", token: token(userId) }));
  return messages(await drainUntilSilent(sock));
}

/* ── tests ───────────────────────────────────────────────────────── */

describe("MudWsServer — character creation flow", () => {
  let booted: Booted;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterEach(async () => {
    await booted.close();
    delete process.env.JWT_SECRET;
  });

  it("prompts a brand-new user for a name instead of auto-spawning", async () => {
    booted = await boot(fakePrisma());
    const client = await openClient(booted.url);
    const lines = await authNew(client, "u-prompt");

    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("don't have a character"))).toBe(true);
    expect(lines.some((l) => /create/i.test(l))).toBe(true);
    client.close();
  });

  it("creates the player at the spawn and auto-looks on `create <name>`", async () => {
    booted = await boot(fakePrisma());
    const client = await openClient(booted.url);
    await authNew(client, "u-create");

    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Aelric" }),
    );
    const lines = messages(await drainUntilSilent(client));

    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    const data = booted.prisma.mudPlayer.create.mock.calls[0]?.[0]
      ?.data as Record<string, unknown>;
    expect(data.name).toBe("Aelric");
    expect(data.roomId).toBe(ROOM_SQUARE.id);
    expect(lines.some((l) => l.includes("Welcome, Aelric"))).toBe(true);
    expect(lines.some((l) => l === ROOM_SQUARE.name)).toBe(true);
    client.close();
  });

  it("accepts a bare name without the `create` verb", async () => {
    booted = await boot(fakePrisma());
    const client = await openClient(booted.url);
    await authNew(client, "u-bare");

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "Brunhild" }));
    const lines = messages(await drainUntilSilent(client));

    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    const data = booted.prisma.mudPlayer.create.mock.calls[0]?.[0]
      ?.data as Record<string, unknown>;
    expect(data.name).toBe("Brunhild");
    expect(lines.some((l) => l.includes("Welcome, Brunhild"))).toBe(true);
    client.close();
  });

  it("rejects a blank name and still accepts a valid retry", async () => {
    booted = await boot(fakePrisma());
    const client = await openClient(booted.url);
    await authNew(client, "u-blank");

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "   " }));
    const rejected = messages(await drainUntilSilent(client));
    expect(rejected.some((l) => l.includes("can't be empty"))).toBe(true);
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();

    // The socket is still awaiting a name — a valid retry succeeds.
    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Cara" }),
    );
    const accepted = messages(await drainUntilSilent(client));
    expect(booted.prisma.mudPlayer.create).toHaveBeenCalledTimes(1);
    expect(accepted.some((l) => l.includes("Welcome, Cara"))).toBe(true);
    client.close();
  });

  it("surfaces a friendly 'name is taken' message on a unique violation", async () => {
    booted = await boot(
      fakePrisma(async () => {
        throw new Error(
          "Unique constraint failed on the fields: (`name`)",
        );
      }),
    );
    const client = await openClient(booted.url);
    await authNew(client, "u-dupe");

    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Dahlia" }),
    );
    const lines = messages(await drainUntilSilent(client));
    expect(lines.some((l) => /name is taken/i.test(l))).toBe(true);
    // No session opened: a retry is still routed through creation.
    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Dahlia" }),
    );
    const retry = messages(await drainUntilSilent(client));
    expect(retry.some((l) => /name is taken/i.test(l))).toBe(true);
    client.close();
  });

  it("surfaces the underlying message on a non-unique create failure", async () => {
    booted = await boot(
      fakePrisma(async () => {
        throw new Error("db offline");
      }),
    );
    const client = await openClient(booted.url);
    await authNew(client, "u-err");

    client.send(
      JSON.stringify({ type: "CLIENT_MESSAGE", message: "create Eira" }),
    );
    const lines = messages(await drainUntilSilent(client));
    expect(lines.some((l) => l.includes("Couldn't create character"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("db offline"))).toBe(true);
    client.close();
  });
});
