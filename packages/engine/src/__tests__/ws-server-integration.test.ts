/**
 * End-to-end WebSocket + dispatcher integration. Boots a real WS
 * server with a hydrated WorldState (no DB), connects a client,
 * walks through AUTH → spawn look → move → talk → quit.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import WebSocket from "ws";

import type { CachedNpc, CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";
import { MudWsServer } from "../ws-server.js";

const SECRET = "ws-integration-secret";
const AUDIENCE = "hopper-mud";

function token(userId = "u-1"): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, aud: AUDIENCE, iat: now, exp: now + 60 },
    SECRET,
    { algorithm: "HS256" },
  );
}

function buildWorld(): WorldState {
  const square: CachedRoom = {
    id: "room-square",
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description: "Cobbled square with a fountain.",
    exits: { north: "room-inn" },
    environment: "townsmee",
    area: "townsmee",
    imageName: null,
  };
  const inn: CachedRoom = {
    id: "room-inn",
    enumKey: "TOWNSMEE_INN",
    name: "The Quiet Bed",
    description: "Warm fireplace.",
    exits: { south: "room-square" },
    environment: "townsmee",
    area: "townsmee",
    imageName: null,
  };
  const zofia: CachedNpc = {
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
  const w = new WorldState();
  w.hydrate([square, inn], [zofia]);
  return w;
}

interface Booted {
  url: string;
  server: MudWsServer;
  close(): Promise<void>;
}

async function boot(): Promise<Booted> {
  const http = createServer();
  const ws = new MudWsServer({ server: http, world: buildWorld() });
  await new Promise<void>((resolve, reject) => {
    http.listen(0, "127.0.0.1", () => resolve());
    http.on("error", reject);
  });
  const addr = http.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    server: ws,
    close: async () => {
      await ws.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

function nextFrames(sock: WebSocket, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const buf: string[] = [];
    const onMsg = (raw: WebSocket.RawData): void => {
      buf.push(raw.toString());
      if (buf.length >= count) {
        sock.off("message", onMsg);
        resolve(buf);
      }
    };
    sock.on("message", onMsg);
    sock.once("error", reject);
  });
}

function nextClose(sock: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    sock.once("close", (code) => resolve({ code }));
  });
}

describe("ws-server + world end-to-end", () => {
  let booted: Booted;
  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    booted = await boot();
  });
  afterEach(async () => {
    await booted.close();
    delete process.env.JWT_SECRET;
  });

  it("AUTH → spawn auto-look renders the town square", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: token() }));

    // Expect: AUTH_OK, then 3 SERVER_MESSAGE lines for the spawn
    // look (name, description, exits).
    const frames = await nextFrames(client, 4);
    const parsed = frames.map((f) => JSON.parse(f) as { type: string });
    expect(parsed[0]?.type).toBe("AUTH_OK");
    const messages = parsed
      .slice(1)
      .map((f) => (f as { type: string; message: string }).message);
    expect(messages.some((m) => m === "Town Square")).toBe(true);
    expect(messages.some((m) => m.includes("Exits: north"))).toBe(true);
    client.close();
  });

  it("move north then talk to zofia returns the canned dialog line", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: token() }));
    // Drain AUTH_OK + spawn look (we don't care about the
    // specific contents here, only that the server moves past).
    await nextFrames(client, 4);

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "north" }));
    // Move triggers an auto-look; expect 4 lines (name,
    // description, NPCs-here, exits).
    const moveFrames = await nextFrames(client, 4);
    const moveLines = moveFrames.map(
      (f) => (JSON.parse(f) as { message: string }).message,
    );
    expect(moveLines.some((l) => l === "The Quiet Bed")).toBe(true);
    expect(moveLines.some((l) => l.includes("Zofia"))).toBe(true);

    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "talk zofia" }));
    const talkFrame = JSON.parse(
      (await nextFrames(client, 1))[0]!,
    ) as {
      message: string;
    };
    expect(talkFrame.message).toMatch(/Zofia says/);
    client.close();
  });

  it("quit closes the socket with code 1000", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: token() }));
    await nextFrames(client, 4);
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "quit" }));
    // Expect the farewell line then close.
    await nextFrames(client, 1);
    const closed = await nextClose(client);
    expect(closed.code).toBe(1000);
  });
});

describe("AUTH_OK reports the world's own capabilities", () => {
  /**
   * The point of sending these over the wire is that they describe the
   * process actually serving the connection, so a client cannot be built
   * against one mode and connected to another. That only holds if the frame
   * follows the world rather than a default — which is what this asserts.
   */
  async function bootWithMode(mode: "exploration" | "pve" | "pvp") {
    const http = createServer();
    const world = new WorldState(mode);
    world.hydrate([]);
    const server = new MudWsServer({ server: http, world });
    await new Promise<void>((resolve, reject) => {
      http.listen(0, "127.0.0.1", () => resolve());
      http.once("error", reject);
    });
    const { port } = http.address() as AddressInfo;
    return {
      url: `ws://127.0.0.1:${port}`,
      async close() {
        await server.close();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      },
    };
  }

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it.each([
    ["exploration", false, false] as const,
    ["pve", true, false] as const,
    ["pvp", true, true] as const,
  ])("reports %s as combat=%s pvp=%s", async (mode, combat, pvp) => {
    const booted = await bootWithMode(mode);
    try {
      const client = new WebSocket(booted.url);
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      client.send(JSON.stringify({ type: "AUTH", token: token() }));

      const frame = JSON.parse((await nextFrames(client, 1))[0]!) as {
        type: string;
        mode: string;
        capabilities: { combat: boolean; playerVersusPlayer: boolean };
      };
      expect(frame.type).toBe("AUTH_OK");
      expect(frame.mode).toBe(mode);
      expect(frame.capabilities.combat).toBe(combat);
      expect(frame.capabilities.playerVersusPlayer).toBe(pvp);
      client.close();
    } finally {
      await booted.close();
    }
  });
});
