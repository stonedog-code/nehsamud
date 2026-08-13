/**
 * WebSocket transport for MUD clients.
 *
 * Auth gate matches the Python contract: the FIRST frame from a
 * newly-opened socket MUST be an `AUTH` frame with a valid hopper
 * JWT. Any other frame before AUTH closes the connection with
 * code 4401 ("auth-required"). Once authenticated, the socket is
 * bound to the resolved `userId` for the lifetime of the connection.
 *
 * Phase 4 wires the post-auth dispatch into the command processor.
 * Each authenticated CLIENT_MESSAGE is parsed, dispatched, and the
 * response frames sent back as SERVER_MESSAGE lines. `quit` closes
 * the socket after sending the farewell.
 *
 * Frame shape (JSON, identical to the Python side):
 *   { "type": "AUTH",            "token": "<jwt>"   }   // from client
 *   { "type": "CLIENT_MESSAGE",  "message": "..."  }   // from client
 *   { "type": "SERVER_MESSAGE",  "message": "..."  }   // from server
 *   { "type": "AUTH_OK",         "userId": "...",
 *     "mode": "exploration",     "capabilities": {…} }  // from server
 *   { "type": "AUTH_FAILED",     "error":   "..."  }   // from server
 *
 * Wire compatibility is the goal — the apps/web `MudClient` already
 * speaks these frames against the Python backend and will not be
 * modified during the rewrite.
 */

import { randomUUID } from "node:crypto";
import { type IncomingMessage } from "node:http";
import { type Server as HttpServer } from "node:http";
import { type Tracer } from "@opentelemetry/api";
import { WebSocketServer, type WebSocket } from "ws";

import type { PrismaClient } from "@nehsamud/engine-db";

import type { AiServices } from "./ai/factory.js";
import { verifyHopperToken } from "./auth.js";
import {
  DEFAULT_GAME_MODE,
  capabilitiesFor,
  type GameMode,
  type ModeCapabilities,
} from "./game-mode.js";
import { dispatch } from "./commands/dispatch.js";
import { parseCommand } from "./commands/parser.js";
import {
  createPlayer,
  loadPlayer,
  savePlayerState,
} from "./persistence/player-store.js";
import { RoomArtGenerator } from "./persistence/room-art-generator.js";
import { SessionRegistry } from "./world/session.js";
import type { WorldState } from "./world/world-state.js";

export interface AuthFrame {
  type: "AUTH";
  token: string;
}

export interface ClientMessageFrame {
  type: "CLIENT_MESSAGE";
  message: string;
}

export type ClientFrame = AuthFrame | ClientMessageFrame;

export interface ServerMessageFrame {
  type: "SERVER_MESSAGE";
  message: string;
}

export interface AuthOkFrame {
  type: "AUTH_OK";
  userId: string;
  /**
   * What this world permits, and the mode it is running.
   *
   * Sent here rather than shared with clients as a compile-time constant.
   * A shared constant can only be right if both sides were built from the
   * same version; this is answered by the process actually serving the
   * connection, so a client cannot render an affordance the server will
   * refuse even when the two have drifted.
   *
   * It also keeps the engine out of browser bundles entirely — a UI needs
   * these five booleans, not a package that carries express, Prisma and an
   * OpenTelemetry SDK behind it.
   *
   * Additive to the frame, so an older client that ignores the field keeps
   * working.
   */
  mode: GameMode;
  capabilities: ModeCapabilities;
}

export interface AuthFailedFrame {
  type: "AUTH_FAILED";
  error: string;
}

export type ServerFrame = ServerMessageFrame | AuthOkFrame | AuthFailedFrame;

interface ConnectionState {
  id: string;
  userId?: string;
  authenticated: boolean;
}

export interface ConnectionsSummary {
  total: number;
  authenticated: number;
}

const CLOSE_AUTH_REQUIRED = 4401;
const CLOSE_PROTOCOL_VIOLATION = 1002;

export interface MudWsServerOptions {
  server?: HttpServer;
  port?: number;
  path?: string;
  /** World cache the command processor reads. Optional only so
   * Phase 1-style transport-only tests don't have to construct a
   * world; production callers always supply one. */
  world?: WorldState;
  /** EnumKey of the room a freshly-spawned player lands in. Falls
   * back to "TOWNSMEE_TOWNSQUARE" which the Phase 3 seed always
   * creates. */
  spawnRoomEnumKey?: string;
  /** AI service factory result. Optional — when undefined,
   * handlers fall back to canned behavior. */
  ai?: AiServices;
  /** Prisma client. Optional — when undefined, the server runs
   * in stateless mode (no MudPlayer rows touched, no room art).
   * Phase 7 production callers always supply one; Phase 1-6
   * tests don't. */
  prisma?: PrismaClient;
  /** Test seam — inject a custom RoomArtGenerator so unit tests
   * can swap in a fake without dragging the real fs/Prisma. */
  roomArt?: RoomArtGenerator;
  /** Optional OpenTelemetry tracer. When provided, every command
   * dispatch is wrapped in a span. When unset, no spans created. */
  tracer?: Tracer;
}

const DEFAULT_SPAWN_ROOM_ENUM_KEY = "TOWNSMEE_TOWNSQUARE";

export class MudWsServer {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<WebSocket, ConnectionState>();
  private readonly sessions = new SessionRegistry();
  private readonly world: WorldState | undefined;
  private readonly spawnRoomEnumKey: string;
  private readonly ai: AiServices | undefined;
  private readonly prisma: PrismaClient | undefined;
  private readonly roomArt: RoomArtGenerator;
  private readonly tracer: Tracer | undefined;
  /** Map of socket → MudPlayer.id so we know which row to update
   * after each dispatch. */
  private readonly playerIdBySocket = new WeakMap<WebSocket, string>();
  /** Connections that have authenticated but don't have a MudPlayer
   * row yet. The next CLIENT_MESSAGE is parsed as
   *   `create <name>`  (or just `<name>`)
   * to seed the character. Cleared once the player exists and the
   * regular session is open. */
  private readonly awaitingPlayerName = new WeakSet<WebSocket>();

  constructor(options: MudWsServerOptions) {
    this.world = options.world;
    this.spawnRoomEnumKey = options.spawnRoomEnumKey ?? DEFAULT_SPAWN_ROOM_ENUM_KEY;
    this.ai = options.ai;
    this.prisma = options.prisma;
    this.roomArt = options.roomArt ?? new RoomArtGenerator();
    this.tracer = options.tracer;
    this.wss = new WebSocketServer({
      server: options.server,
      port: options.port,
      path: options.path,
    });
    this.wss.on("connection", (socket, req) => this.onConnection(socket, req));
  }

  summary(): ConnectionsSummary {
    let authenticated = 0;
    for (const s of this.connections.values()) {
      if (s.authenticated) authenticated += 1;
    }
    return { total: this.connections.size, authenticated };
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Exposed for tests; production callers use the listening port. */
  get address() {
    return this.wss.address();
  }

  private onConnection(socket: WebSocket, _req: IncomingMessage): void {
    const state: ConnectionState = {
      id: randomUUID(),
      authenticated: false,
    };
    this.connections.set(socket, state);

    socket.on("message", (raw) => this.onMessage(socket, state, raw.toString()));
    socket.on("close", () => {
      this.connections.delete(socket);
      this.sessions.close(socket);
    });
  }

  private onMessage(socket: WebSocket, state: ConnectionState, raw: string): void {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw) as ClientFrame;
    } catch {
      socket.close(CLOSE_PROTOCOL_VIOLATION, "malformed JSON frame");
      return;
    }

    if (!state.authenticated) {
      if (frame.type !== "AUTH") {
        // Same code Python sent so apps/web's reconnect-on-4401 logic
        // doesn't need to change.
        socket.close(CLOSE_AUTH_REQUIRED, "auth-required");
        return;
      }
      const result = verifyHopperToken(frame.token);
      if (!result.ok || !result.userId) {
        send(socket, { type: "AUTH_FAILED", error: result.error ?? "auth failed" });
        socket.close(CLOSE_AUTH_REQUIRED, "auth-required");
        return;
      }
      state.authenticated = true;
      state.userId = result.userId;
      this.onAuthenticated(socket, result.userId);
      return;
    }

    if (frame.type !== "CLIENT_MESSAGE") {
      return;
    }
    this.handleClientMessage(socket, frame.message);
  }

  private onAuthenticated(socket: WebSocket, userId: string): void {
    // Falls back to the safe mode when there is no world — the Phase 1
    // transport-only tests construct the server without one, and a frame
    // that claimed combat was available in that state would be wrong in the
    // dangerous direction.
    const mode: GameMode = this.world?.mode ?? DEFAULT_GAME_MODE;
    send(socket, {
      type: "AUTH_OK",
      userId,
      mode,
      capabilities: capabilitiesFor(mode),
    });
    if (!this.world) {
      // Transport-only mode (Phase 1 tests). No world means no
      // session, so subsequent CLIENT_MESSAGE frames bounce off
      // the world-not-loaded branch in handleClientMessage.
      return;
    }
    const world = this.world;
    const spawnRoom = world.getRoomByEnumKey(this.spawnRoomEnumKey);
    if (!spawnRoom) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `World loaded but spawn room "${this.spawnRoomEnumKey}" is missing. Contact an admin.`,
      });
      return;
    }
    void (async () => {
      // No persistence layer (Phase 1-style tests with a hydrated
      // WorldState but no Prisma) — skip the load + prompt and jump
      // straight to an ephemeral session at the spawn.
      if (!this.prisma) {
        await this.startSessionAndAutoLook(socket, userId, spawnRoom.id);
        return;
      }
      const existing = await loadPlayer(this.prisma, userId).catch(() => null);
      if (existing) {
        const startingRoomId =
          existing.roomId && world.getRoom(existing.roomId)
            ? existing.roomId
            : spawnRoom.id;
        this.playerIdBySocket.set(socket, existing.id);
        await this.startSessionAndAutoLook(socket, userId, startingRoomId, {
          startingHp: existing.currentHp,
          startingMaxHp: existing.maxHp,
          startingXp: existing.experience,
        });
        return;
      }
      // No player yet — prompt the user to create one. The next
      // CLIENT_MESSAGE is interpreted as `create <name>` (or just
      // `<name>`) and we route it through `handleCreatePlayer`.
      this.awaitingPlayerName.add(socket);
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "Welcome to HopperMud! You don't have a character yet.",
      });
      send(socket, {
        type: "SERVER_MESSAGE",
        message:
          "Pick a name and type `create <name>` to begin (example: `create Aelric`).",
      });
    })();
  }

  /** Initialize the in-memory session at the given room, schedule
   * room art when applicable, and emit the auto-look response. */
  private async startSessionAndAutoLook(
    socket: WebSocket,
    userId: string,
    startingRoomId: string,
    persisted?: {
      startingHp?: number;
      startingMaxHp?: number;
      startingXp?: number;
    },
  ): Promise<void> {
    const world = this.world!;
    const session = this.sessions.open(socket, userId, startingRoomId);
    if (persisted?.startingHp !== undefined) session.currentHp = persisted.startingHp;
    if (persisted?.startingMaxHp !== undefined) session.maxHp = persisted.startingMaxHp;
    if (persisted?.startingXp !== undefined) session.experience = persisted.startingXp;
    if (session.currentHp === 0) session.defeated = true;

    if (this.prisma) {
      this.roomArt.scheduleIfNeeded(
        session.currentRoomId,
        world,
        this.ai?.image,
        this.prisma,
      );
    }

    const look = await dispatch({
      world,
      session,
      command: { verb: "look", args: [], rest: "" },
      ai: this.ai,
      tracer: this.tracer,
    });
    for (const line of look.response.lines) {
      send(socket, { type: "SERVER_MESSAGE", message: line });
    }
    await this.persistAfterDispatch(socket, session);
  }

  /** Parse the first post-AUTH CLIENT_MESSAGE as `create <name>` or
   * just `<name>`. Create the player, mark the socket as no longer
   * awaiting, and open the session. */
  private async handleCreatePlayer(
    socket: WebSocket,
    userId: string,
    raw: string,
  ): Promise<void> {
    if (!this.world || !this.prisma) {
      // Shouldn't happen — `awaitingPlayerName` is only set when
      // both are present. Defensive guard so a misuse doesn't
      // crash the process.
      this.awaitingPlayerName.delete(socket);
      return;
    }
    // Accept either `create Aelric`, `Aelric`, or even an
    // accidental leading slash. Anything starting with `create`
    // strips the verb; otherwise the whole text is the name.
    const trimmed = raw.trim();
    const m = /^(?:create\s+)?(.+)$/i.exec(trimmed);
    const name = m?.[1]?.trim() ?? "";
    if (!name) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "Name can't be empty. Try `create Aelric`.",
      });
      return;
    }
    const spawnRoom = this.world.getRoomByEnumKey(this.spawnRoomEnumKey);
    if (!spawnRoom) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `Spawn room "${this.spawnRoomEnumKey}" missing. Contact an admin.`,
      });
      return;
    }
    let created;
    try {
      created = await createPlayer(this.prisma, userId, name, spawnRoom.id);
    } catch (err) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message:
          err instanceof Error && /unique/i.test(err.message)
            ? `That name is taken. Try another with \`create <name>\`.`
            : `Couldn't create character: ${
                err instanceof Error ? err.message : String(err)
              }. Try \`create <name>\` again.`,
      });
      return;
    }
    this.awaitingPlayerName.delete(socket);
    this.playerIdBySocket.set(socket, created.id);
    send(socket, {
      type: "SERVER_MESSAGE",
      message: `Welcome, ${created.name}! Your adventure begins…`,
    });
    await this.startSessionAndAutoLook(socket, userId, spawnRoom.id);
  }

  private handleClientMessage(socket: WebSocket, raw: string): void {
    if (!this.world) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "(server is in transport-only mode — no world loaded)",
      });
      return;
    }
    // First post-AUTH message for a brand-new user: route through the
    // character-creation handler, not the gameplay dispatcher.
    if (this.awaitingPlayerName.has(socket)) {
      const conn = this.connections.get(socket);
      const userId = conn?.userId;
      if (!userId) {
        // Lost the auth state somehow — let the next frame re-trigger
        // the protocol-level handling.
        this.awaitingPlayerName.delete(socket);
        return;
      }
      void this.handleCreatePlayer(socket, userId, raw);
      return;
    }
    const world = this.world;
    const session = this.sessions.get(socket);
    if (!session) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "(no session — re-authenticate to play)",
      });
      return;
    }
    const command = parseCommand(raw);
    void (async () => {
      const roomBefore = session.currentRoomId;
      const result = await dispatch({
        world,
        session,
        command,
        ai: this.ai,
        tracer: this.tracer,
      });
      for (const line of result.response.lines) {
        send(socket, { type: "SERVER_MESSAGE", message: line });
      }
      // Trigger room-art generation if the player walked into a
      // new room.
      if (this.prisma && session.currentRoomId !== roomBefore) {
        this.roomArt.scheduleIfNeeded(
          session.currentRoomId,
          world,
          this.ai?.image,
          this.prisma,
        );
      }
      await this.persistAfterDispatch(socket, session);
      if (result.closeSocket) {
        socket.close(1000, "client-quit");
      }
    })();
  }

  private async persistAfterDispatch(
    socket: WebSocket,
    session: import("./world/session.js").SessionState,
  ): Promise<void> {
    if (!this.prisma) return;
    const playerId = this.playerIdBySocket.get(socket);
    if (!playerId) return;
    try {
      await savePlayerState(this.prisma, playerId, session);
    } catch {
      // Swallowed: a Postgres hiccup shouldn't kill the player's
      // connection. The next save attempt will retry the full
      // session state.
    }
  }
}

function send(socket: WebSocket, frame: ServerFrame): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}
