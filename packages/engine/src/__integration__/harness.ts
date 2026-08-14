/**
 * Boot a real engine against a real database, and drive a real socket.
 *
 * Everything here is deliberately the production path: `createDb` builds
 * the same Prisma client the server does, `WorldState.load` reads the same
 * tables, `MudWsServer` is the same class, and the client is an actual
 * WebSocket over TCP. The only concession is the port.
 *
 * No fakes. That is the entire point of the tier — a mocked Prisma client
 * agrees with a query the real schema rejects, and an in-process fake
 * agrees with a frame the real socket would never deliver.
 */

import { createServer, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { WebSocket } from "ws";

import type { PrismaClient } from "@nehsamud/engine-db";

import { createDb } from "../db.js";
import { resolveGameMode, type GameMode } from "../game-mode.js";
import { WorldState } from "../world/world-state.js";
import { MudWsServer } from "../ws-server.js";

/** Shared with the engine's verifier via the environment, as in production. */
const SECRET = process.env.JWT_SECRET ?? "integration-secret";
const AUDIENCE = "hopper-mud";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * A signed token for an owner id.
 *
 * Minted rather than mocked, so the auth path under test is the real
 * verification and not a stub that always says yes.
 */
export function token(ownerId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: ownerId,
    aud: AUDIENCE,
    iat: now,
    exp: now + 600,
  });
  const signature = createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** A fresh owner id per test, so suites cannot see each other's characters. */
export function newOwnerId(): string {
  return randomUUID();
}

export interface Harness {
  url: string;
  prisma: PrismaClient;
  world: WorldState;
  close: () => Promise<void>;
}

/**
 * Boot the engine on an ephemeral port.
 *
 * Port 0 rather than a fixed one: these suites run serially but alongside
 * whatever else is on the machine, and a hardcoded port turns "something
 * else is listening" into a confusing test failure.
 */
export async function bootEngine(
  mode: GameMode = resolveGameMode({ MUD_GAME_MODE: "pve" }),
): Promise<Harness> {
  const prisma = createDb({
    databaseUrl: process.env.MUD_DATABASE_URL!,
    log: ["error"],
  });
  const world = new WorldState(mode);
  await world.load(prisma);

  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const server = new MudWsServer({ server: http, world, prisma });
  const { port } = http.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${port}`,
    prisma,
    world,
    close: async () => {
      await server.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
}

/** A connected client that collects server lines. */
export class Client {
  private readonly socket: WebSocket;
  private lines: string[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        type: string;
        message?: string;
      };
      if (frame.type === "SERVER_MESSAGE" && frame.message !== undefined) {
        this.lines.push(frame.message);
      }
    });
  }

  static async open(url: string): Promise<Client> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new Client(socket);
  }

  send(frame: object): void {
    this.socket.send(JSON.stringify(frame));
  }

  /**
   * Send a frame and return everything the server said in response.
   *
   * Drains until the socket has been quiet for `idleMs` rather than waiting
   * for a fixed line count: a command's reply length varies with what is in
   * the room and how a combat roll landed, so counting lines makes the test
   * fail on a lucky critical hit.
   */
  async exchange(frame: object, idleMs = 350): Promise<string[]> {
    this.lines = [];
    this.send(frame);
    return this.drain(idleMs);
  }

  async drain(idleMs = 350): Promise<string[]> {
    let settled = this.lines.length;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, idleMs));
      if (this.lines.length === settled) break;
      settled = this.lines.length;
    }
    return [...this.lines];
  }

  /** Authenticate and drain the greeting. */
  async auth(ownerId: string): Promise<string[]> {
    return this.exchange({ type: "AUTH", token: token(ownerId) });
  }

  /** Type a command, as a player would. */
  async type(message: string): Promise<string[]> {
    return this.exchange({ type: "CLIENT_MESSAGE", message });
  }

  close(): void {
    this.socket.close();
  }
}
