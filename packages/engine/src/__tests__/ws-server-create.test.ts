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
import {
  drainUntil,
  parseMessages as messages,
  type Predicate,
} from "./support/ws-drain.js";

// See mud-smoke.test.ts: the waits below are condition-based, so jest's own
// 5s ceiling must sit above the helpers' failure cap or it fires first and
// discards their diagnostic (NEH-924).
jest.setTimeout(30_000);

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
  area: "townsmee",
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

function fakePrisma(
  createImpl?: (data: Record<string, unknown>) => Promise<FakeRow>,
) {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => {
    if (createImpl) return createImpl(args.data);
    const row: FakeRow = {
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
  });
  return {
    mudPlayer: {
      findFirst: jest.fn(async (args: { where: { ownerId: string } }) =>
        rows.get(args.where.ownerId) ?? null,
      ),
      create,
      update: jest.fn(async () => undefined),
    },
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

async function authNew(sock: WebSocket, userId: string): Promise<string[]> {
  sock.send(JSON.stringify({ type: "AUTH", token: token(userId) }));
  return messages(
    await drainUntil(sock, (m) => m.some((l) => l.includes("don't have a character")), {
      label: "the no-character prompt",
    }),
  );
}

/* ── tests ───────────────────────────────────────────────────────── */

/**
 * Walk the three-step creation flow and return the frames from the LAST step.
 *
 * Creation stopped being one message when race and class stopped being
 * defaulted. The earlier steps only ask questions, so the interesting frames
 * — the welcome, or whatever went wrong — all arrive on the third.
 */
async function createViaFlow(
  client: WebSocket,
  name: string,
  /**
   * What the LAST step is expected to say. It differs per test — a welcome,
   * "name is taken", a create failure — so the caller names it rather than
   * the helper guessing, and the wait ends on that line rather than on a
   * quiet socket (NEH-924).
   */
  awaiting: Predicate,
  opts: { bare?: boolean; race?: string; characterClass?: string } = {},
): Promise<string[]> {
  client.send(
    JSON.stringify({
      type: "CLIENT_MESSAGE",
      message: opts.bare ? name : `create ${name}`,
    }),
  );
  await drainUntil(client, (m) => m.some((l) => l.includes("Choose a race")), {
    label: "the race prompt",
  });
  client.send(
    JSON.stringify({
      type: "CLIENT_MESSAGE",
      message: opts.race ?? "dwarf",
    }),
  );
  await drainUntil(client, (m) => m.some((l) => l.includes("choose a class")), {
    label: "the class prompt",
  });
  client.send(
    JSON.stringify({
      type: "CLIENT_MESSAGE",
      message: opts.characterClass ?? "mage",
    }),
  );
  return drainUntil(client, awaiting, { label: `the creation outcome for ${name}` });
}

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

  it("creates the player at the spawn and auto-looks once all three answers are in", async () => {
    booted = await boot(fakePrisma());
    const client = await openClient(booted.url);
    await authNew(client, "u-create");

    const lines = messages(
      await createViaFlow(client, "Aelric", (m) =>
        m.some((l) => l === ROOM_SQUARE.name),
      ),
    );

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

    const lines = messages(
      await createViaFlow(
        client,
        "Brunhild",
        (m) => m.some((l) => l.includes("Welcome, Brunhild")),
        { bare: true },
      ),
    );

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
    const rejected = messages(
      await drainUntil(client, (m) => m.some((l) => l.includes("can't be empty")), {
        label: "the blank-name refusal",
      }),
    );
    expect(rejected.some((l) => l.includes("can't be empty"))).toBe(true);
    expect(booted.prisma.mudPlayer.create).not.toHaveBeenCalled();

    // The socket is still awaiting a name — a valid retry succeeds.
    const accepted = messages(
      await createViaFlow(client, "Cara", (m) =>
        m.some((l) => l.includes("Welcome, Cara")),
      ),
    );
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

    const taken: Predicate = (m) => m.some((l) => /name is taken/i.test(l));
    const lines = messages(await createViaFlow(client, "Dahlia", taken));
    expect(lines.some((l) => /name is taken/i.test(l))).toBe(true);

    // A name collision rewinds to the NAME step, so the obvious retry —
    // typing `create <name>` again — is read as a name and not as an answer
    // to the race question the player never got back to.
    const retry = messages(await createViaFlow(client, "Dahlia", taken));
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

    const lines = messages(
      await createViaFlow(client, "Eira", (m) =>
        m.some((l) => l.includes("db offline")),
      ),
    );
    expect(lines.some((l) => l.includes("Couldn't create character"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("db offline"))).toBe(true);
    client.close();
  });
});
