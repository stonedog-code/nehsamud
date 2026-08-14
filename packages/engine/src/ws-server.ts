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
import type { Rng } from "./combat.js";
import { verifyHopperToken } from "./auth.js";
import {
  DEFAULT_GAME_MODE,
  capabilitiesFor,
  type GameMode,
  type ModeCapabilities,
} from "./game-mode.js";
import { dispatch } from "./commands/dispatch.js";
import type { Broadcast } from "./commands/types.js";
import { parseCommand } from "./commands/parser.js";
import {
  applyDeathDrop,
  saveInventoryAndRoom,
  createPlayer,
  rebirthPlayer,
  loadPlayer,
  loadInventory,
  listOptionGroups,
  saveInventory,
  savePlayerState,
  type CharacterChoice,
  type OptionGroup,
} from "./persistence/player-store.js";
import { RoomArtGenerator } from "./persistence/room-art-generator.js";
import { levelForXp } from "./progression.js";
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

/**
 * Create a character in one frame, with the choices already made.
 *
 * The web client has a full picker with a stat preview, so making it replay
 * a conversational flow would be theatre. The text flow below exists for
 * terminal users; this exists for a client that already knows the answers.
 *
 * `options` is a map of group key → option slug, e.g.
 * `{ race: "elf", class: "mage" }`. It was two fixed fields, `race` and
 * `class`, which meant the wire protocol carried the same genre assumption
 * the schema did: a world with different axes could not express a character
 * over it at all.
 */
export interface CreateCharacterFrame {
  type: "CREATE_CHARACTER";
  name: string;
  options: Record<string, string>;
}

export type ClientFrame =
  | AuthFrame
  | ClientMessageFrame
  | CreateCharacterFrame;

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
  /**
   * Source of randomness for combat rolls. Seeded in tests so a fight is
   * reproducible and assertable; unset in production, where each round
   * seeds itself from the clock.
   *
   * Threaded the same way as `tracer` deliberately — a handler that rolls
   * needs the same kind of injected seam as one that traces, and inventing
   * a second mechanism for it would be a second thing to remember.
   */
  rng?: Rng;
}

const DEFAULT_SPAWN_ROOM_ENUM_KEY = "TOWNSMEE_TOWNSQUARE";

/**
 * PlayerRecord → the session's character sheet.
 *
 * Both login paths — an existing player and a freshly created one — must
 * produce the same sheet, or `statistics` shows a race on one and nothing on
 * the other depending on how you got here.
 */
function sheetFor(record: {
  options: Array<{ groupName: string; optionName: string }>;
  attributes: {
    strength: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    constitution: number;
    dexterity: number;
    luck: number;
  };
}): import("./world/session.js").CharacterSheet {
  return {
    options: record.options.map((o) => ({
      groupName: o.groupName,
      optionName: o.optionName,
    })),
    ...record.attributes,
  };
}

function nextUnanswered(
  groups: OptionGroup[],
  choice: CharacterChoice,
): OptionGroup | undefined {
  // Skipped when it has nothing to offer even if required: a required group
  // with no selectable options is a seeding fault, and asking a question
  // with no valid answer would strand the player in a loop they cannot
  // leave. `createPlayer` reports it as the seeding fault it is.
  return groups.find((g) => choice[g.key] === undefined && g.options.length > 0);
}

/**
 * Match what the player typed to one of the offered options.
 *
 * Slug, then exact name, then prefix — so `half-orc`, `Half-Orc` and `half`
 * all land on the same row. Case-insensitive throughout, because nobody
 * types a capital letter into a MUD.
 */
function matchOption<T extends { slug: string; name: string }>(
  options: T[],
  typed: string,
): T | undefined {
  const q = typed.trim().toLowerCase();
  if (!q) return undefined;
  return (
    options.find((o) => o.slug.toLowerCase() === q) ??
    options.find((o) => o.name.toLowerCase() === q) ??
    options.find((o) => o.name.toLowerCase().startsWith(q))
  );
}

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
  private readonly rng: Rng | undefined;
  /** Map of socket → MudPlayer.id so we know which row to update
   * after each dispatch. */
  private readonly playerIdBySocket = new WeakMap<WebSocket, string>();
  /**
   * userId -> socket, for delivering messages to players OTHER than the one
   * who typed the command.
   *
   * A real Map rather than a WeakMap, because it has to be enumerable and
   * looked up by id — and therefore has to be cleaned up on close, which the
   * WeakMaps above get for free. `close` does that.
   */
  private readonly socketByUserId = new Map<string, WebSocket>();
  /** Connections that have authenticated but don't have a MudPlayer
   * row yet. The next CLIENT_MESSAGE is parsed as
   *   `create <name>`  (or just `<name>`)
   * to seed the character. Cleared once the player exists and the
   * regular session is open. */
  /**
   * Half-finished character creation, for the text flow.
   *
   * A WeakSet could only record THAT a socket was mid-creation; the flow now
   * has three answers to collect, so it needs somewhere to put the first two.
   */
  private readonly pendingCreation = new Map<
    WebSocket,
    { name?: string; choice: CharacterChoice }
  >();

  constructor(options: MudWsServerOptions) {
    this.world = options.world;
    this.spawnRoomEnumKey = options.spawnRoomEnumKey ?? DEFAULT_SPAWN_ROOM_ENUM_KEY;
    this.ai = options.ai;
    this.prisma = options.prisma;
    this.roomArt = options.roomArt ?? new RoomArtGenerator();
    this.tracer = options.tracer;
    this.rng = options.rng;
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
      // Drop the userId->socket entry BEFORE closing the session, while the
      // session still knows which user this was. A real Map does not clean
      // itself up the way the WeakMaps beside it do, and a stale entry means
      // broadcasts delivered into a dead socket forever.
      const closing = this.sessions.get(socket);
      if (closing) this.socketByUserId.delete(closing.userId);
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

    if (frame.type === "CREATE_CHARACTER") {
      const userId = state.userId;
      if (!userId) return;
      void this.createCharacter(socket, userId, frame.name, frame.options ?? {});
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
          characterName: existing.name,
          sheet: sheetFor(existing),
        });
        return;
      }
      // No player yet — prompt the user to create one. The next
      // CLIENT_MESSAGE is interpreted as `create <name>` (or just
      // `<name>`) and we route it through `handleCreatePlayer`.
      this.pendingCreation.set(socket, { choice: {} });
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "Welcome! You don't have a character yet.",
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
      characterName?: string;
      sheet?: import("./world/session.js").CharacterSheet;
    },
  ): Promise<void> {
    const world = this.world!;
    const session = this.sessions.open(socket, userId, startingRoomId);
    this.socketByUserId.set(userId, socket);
    // The session has always had this field and nothing ever filled it. It
    // did not matter while every command answered only the player who typed
    // it; the moment other players read your name, an unset one renders as
    // "Someone" to everyone in the room.
    if (persisted?.characterName) session.characterName = persisted.characterName;
    if (persisted?.sheet) session.sheet = persisted.sheet;
    if (persisted?.startingHp !== undefined) session.currentHp = persisted.startingHp;
    if (persisted?.startingMaxHp !== undefined) session.maxHp = persisted.startingMaxHp;
    if (persisted?.startingXp !== undefined) session.experience = persisted.startingXp;
    // Derived, never read from the stored `level` column. That column is a
    // cache refreshed on save; the experience is the fact. Recomputing here
    // means a row whose level drifted — a lost write, a hand edit — corrects
    // itself on the next login instead of persisting the disagreement.
    session.level = levelForXp(session.experience);
    // Carried items are loaded here rather than lazily on the first
    // `inventory`, so `drop` works on the first command of a session too.
    const playerId = this.playerIdBySocket.get(socket);
    if (this.prisma && playerId) {
      try {
        session.inventory = await loadInventory(this.prisma, playerId);
      } catch {
        // An unreadable inventory must not block the login. The player sees
        // an empty bag until the next successful load; losing the session
        // entirely would be the worse failure.
      }
    }
    if (session.currentHp === 0) session.defeated = true;

    if (this.prisma) {
      this.roomArt.scheduleIfNeeded(
        session.currentRoomId,
        world,
        this.ai?.image,
        this.prisma,
      );
    }

    // Also on the way in, so the auto-look below shows a world that is
    // current rather than one frozen at the last player's last command.
    this.announceRespawns(world);

    const look = await dispatch({
      world,
      session,
      command: { verb: "look", args: [], rest: "" },
      ai: this.ai,
      tracer: this.tracer,
      rng: this.rng,
      sessions: this.sessions,
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
      // Shouldn't happen — `pendingCreation` is only set when both are
      // present. Defensive guard so a misuse doesn't crash the process.
      this.pendingCreation.delete(socket);
      return;
    }
    const pending = this.pendingCreation.get(socket) ?? { choice: {} };
    const trimmed = raw.trim();

    /* ── Step 1: the name ──────────────────────────────────────── */
    if (pending.name === undefined) {
      // Accept `create Aelric`, `Aelric`, or an accidental leading verb.
      const m = /^(?:create\s+)?(.+)$/i.exec(trimmed);
      const name = m?.[1]?.trim() ?? "";
      if (!name) {
        send(socket, {
          type: "SERVER_MESSAGE",
          message: "Name can't be empty. Try `create Aelric`.",
        });
        return;
      }
      pending.name = name;
      this.pendingCreation.set(socket, pending);
      // Ask the first question, or create straight away for a pack that has
      // none to ask.
      await this.askNextOrCreate(socket, userId, pending);
      return;
    }

    /* ── Step 2..n: one question per axis the pack declares ────── */
    const groups = await listOptionGroups(this.prisma);
    const asking = nextUnanswered(groups, pending.choice);
    if (!asking) {
      // Every question is answered and we are still here — a stray frame
      // arriving between the last answer and the create finishing. Ignore it
      // rather than treating it as an answer to nothing.
      return;
    }

    const chosen = matchOption(asking.options, trimmed);
    if (!chosen) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `"${trimmed}" isn't one of the ${asking.name.toLowerCase()} choices. Choose one of: ${asking.options
          .map((o) => o.name)
          .join(", ")}.`,
      });
      return;
    }
    pending.choice[asking.key] = chosen.slug;
    this.pendingCreation.set(socket, pending);
    await this.askNextOrCreate(socket, userId, pending, chosen.name);
  }

  /**
   * Ask the next unanswered axis, or create the character once none remain.
   *
   * One method for both, because "are there more questions" and "is it time
   * to create" are the same question — and a pack that declares no axes at
   * all must land in the create branch on its very first call rather than
   * waiting forever for an answer nobody was asked for.
   */
  private async askNextOrCreate(
    socket: WebSocket,
    userId: string,
    pending: { name?: string; choice: CharacterChoice },
    acknowledging?: string,
  ): Promise<void> {
    if (!this.prisma || pending.name === undefined) return;
    const groups = await listOptionGroups(this.prisma);
    const next = nextUnanswered(groups, pending.choice);
    if (!next) {
      await this.createCharacter(socket, userId, pending.name, pending.choice);
      return;
    }
    const prefix = acknowledging ? `${acknowledging} it is. Now c` : "C";
    send(socket, {
      type: "SERVER_MESSAGE",
      message: `${prefix}hoose a ${next.name.toLowerCase()}: ${next.options
        .map((o) => o.name)
        .join(", ")}.`,
    });
  }

  /**
   * Create the character and drop the player into the world.
   *
   * Shared by the structured CREATE_CHARACTER frame and the last step of the
   * text flow, so a character made from the web picker and one made by
   * typing are the same character — including which failures are reported
   * and how.
   */
  private async createCharacter(
    socket: WebSocket,
    userId: string,
    name: string,
    choice: CharacterChoice,
  ): Promise<void> {
    if (!this.world || !this.prisma) return;

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
      created = await createPlayer(
        this.prisma,
        userId,
        name,
        spawnRoom.id,
        choice,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nameTaken = /unique/i.test(message);
      send(socket, {
        type: "SERVER_MESSAGE",
        message: nameTaken
          ? "That name is taken. Try another with `create <name>`."
          : `Couldn't create character: ${message}`,
      });

      // Recovery has to rewind to the step that actually failed, or the
      // player's retry is read as an answer to a different question. A
      // rejected NAME means asking for a name again — otherwise
      // "create Dahlia" arrives while the server is waiting for a race and
      // is rejected as an unknown race, which is a baffling thing to be told.
      // Anything else keeps the name and re-asks the choices.
      const pending = this.pendingCreation.get(socket);
      if (pending) {
        pending.choice = {};
        if (nameTaken) delete pending.name;
        this.pendingCreation.set(socket, pending);
      }
      return;
    }

    this.pendingCreation.delete(socket);
    this.playerIdBySocket.set(socket, created.id);
    // "Aelric the Elf Mage" for a pack with those axes, plain "Aelric" for a
    // pack with none. Composed from what the character actually has rather
    // than from two fields the engine assumes every character carries.
    const described = created.options.map((o) => o.optionName).join(" ");
    send(socket, {
      type: "SERVER_MESSAGE",
      message: `Welcome, ${created.name}${described ? ` the ${described}` : ""}! Your adventure begins…`,
    });
    await this.startSessionAndAutoLook(socket, userId, spawnRoom.id, {
      characterName: created.name,
      sheet: sheetFor(created),
    });
  }

  private handleClientMessage(socket: WebSocket, raw: string): void {
    if (!this.world) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: "(server is in transport-only mode — no world loaded)",
      });
      return;
    }
    // A character that spent its ninth life is choosing what to come back
    // as. Same questions as creation, so a player answers them the way they
    // already know how — and the same validation, so a rebirth cannot reach
    // a build creation would refuse.
    const rebirthSession = this.sessions.get(socket);
    if (rebirthSession?.pendingRebirth) {
      const conn = this.connections.get(socket);
      if (conn?.userId) {
        void this.handleRebirth(socket, rebirthSession, raw);
        return;
      }
    }
    // First post-AUTH message for a brand-new user: route through the
    // character-creation handler, not the gameplay dispatcher.
    if (this.pendingCreation.has(socket)) {
      const conn = this.connections.get(socket);
      const userId = conn?.userId;
      if (!userId) {
        // Lost the auth state somehow — let the next frame re-trigger
        // the protocol-level handling.
        this.pendingCreation.delete(socket);
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
      // Time advances when somebody plays, not on a timer. Done before the
      // command so a hostile that is due is present for the verb about to
      // run — otherwise `look` would report an empty room and the next
      // command would be answered by something the player never saw arrive.
      this.announceRespawns(world);
      const roomBefore = session.currentRoomId;
      const result = await dispatch({
        world,
        session,
        command,
        ai: this.ai,
        tracer: this.tracer,
        rng: this.rng,
        sessions: this.sessions,
      });
      for (const line of result.response.lines) {
        send(socket, { type: "SERVER_MESSAGE", message: line });
      }
      this.deliverBroadcasts(session, result.response.broadcasts);
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
      // A PVP kill changes somebody ELSE's row — their HP, and their whole
      // inventory moving to the floor. `persistAfterDispatch` only ever
      // saves the player who typed, so without this the victim's belongings
      // would still be in the database while the world showed them on the
      // ground: a restart would hand them back and duplicate everything the
      // winner took.
      await this.persistOtherSessions(session);
      if (result.closeSocket) {
        socket.close(1000, "client-quit");
      }
    })();
  }

  /**
   * Collect the answers for a rebirth, then re-make the character.
   *
   * Reuses `pendingCreation` as the scratchpad because the questions are
   * identical — a second half-answered-choices structure would be a second
   * thing to keep in step with the option groups.
   */
  private async handleRebirth(
    socket: WebSocket,
    session: import("./world/session.js").SessionState,
    raw: string,
  ): Promise<void> {
    if (!this.prisma || !this.world) return;
    const pending = this.pendingCreation.get(socket) ?? {
      name: session.characterName,
      choice: {},
    };
    const groups = await listOptionGroups(this.prisma);
    const asking = nextUnanswered(groups, pending.choice);

    if (asking) {
      const chosen = matchOption(asking.options, raw.trim());
      if (!chosen) {
        send(socket, {
          type: "SERVER_MESSAGE",
          message: `"${raw.trim()}" isn't one of the ${asking.name.toLowerCase()} choices. Choose one of: ${asking.options.map((o) => o.name).join(", ")}.`,
        });
        return;
      }
      pending.choice[asking.key] = chosen.slug;
      this.pendingCreation.set(socket, pending);
    }

    const next = nextUnanswered(groups, pending.choice);
    if (next) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `Choose a ${next.name.toLowerCase()}: ${next.options.map((o) => o.name).join(", ")}.`,
      });
      return;
    }

    const playerId = this.playerIdBySocket.get(socket);
    if (!playerId) return;
    try {
      const remade = await rebirthPlayer(this.prisma, playerId, pending.choice);
      this.pendingCreation.delete(socket);
      session.pendingRebirth = false;
      session.sheet = sheetFor(remade);
      session.maxHp = remade.maxHp;
      session.currentHp = remade.currentHp;
      const described = remade.options.map((o) => o.optionName).join(" ");
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `You return${described ? ` as ${described}` : ""}, with ${session.experience} experience and ${session.lives} lives.`,
      });
    } catch (err) {
      send(socket, {
        type: "SERVER_MESSAGE",
        message: `Couldn't remake your character: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Refill any spawn point that is due, and tell whoever is standing there.
   *
   * The message matters: a player in the room would otherwise have to type
   * `look` again to discover something dangerous had walked back in, which
   * reads as the game hiding it from them.
   */
  private announceRespawns(world: WorldState): void {
    for (const instance of world.respawnDue()) {
      for (const s of this.sessions.inRoom(instance.roomId)) {
        const target = this.socketByUserId.get(s.userId);
        if (target) {
          send(target, {
            type: "SERVER_MESSAGE",
            message: `${instance.name} appears.`,
          });
        }
      }
    }
  }

  /**
   * Deliver a command's messages to players other than the one who typed it.
   *
   * Lives here rather than in the handlers so they stay pure: a handler
   * describes WHO should hear WHAT, and this is the only place that knows
   * about sockets. That is what makes every communication verb testable
   * without standing up a server.
   *
   * Delivery is best-effort per recipient. One player's dead socket must not
   * stop the rest of the room hearing what was said, and must not fail the
   * speaker's own command.
   */
  private deliverBroadcasts(
    speaker: import("./world/session.js").SessionState,
    broadcasts: Broadcast[] | undefined,
  ): void {
    if (!broadcasts?.length) return;

    for (const broadcast of broadcasts) {
      const targets: string[] = [];

      if (broadcast.scope === "user" && broadcast.userId) {
        targets.push(broadcast.userId);
      } else if (broadcast.scope === "room" && broadcast.roomId) {
        for (const s of this.sessions.inRoom(broadcast.roomId, speaker.userId)) {
          targets.push(s.userId);
        }
      } else if (broadcast.scope === "adjacent" && broadcast.roomId) {
        // Every room this one connects to. Exits are one-directional in the
        // data even though the fixtures keep them paired, so this reaches
        // where you could WALK from here, which is what "adjacent" means to a
        // player.
        const room = this.world?.getRoom(broadcast.roomId);
        for (const targetRoomId of Object.values(room?.exits ?? {})) {
          for (const s of this.sessions.inRoom(targetRoomId, speaker.userId)) {
            targets.push(s.userId);
          }
        }
      }

      // A player standing in two target sets — adjacent rooms that both lead
      // back here — should hear it once.
      for (const userId of new Set(targets)) {
        if (userId === speaker.userId) continue;
        const target = this.socketByUserId.get(userId);
        if (target) send(target, { type: "SERVER_MESSAGE", message: broadcast.message });
      }
    }
  }

  /**
   * Write back sessions the command changed that did not type it.
   *
   * Only PVP does this today, and only to a victim. Kept narrow on purpose:
   * saving every live session on every command would be a write per player
   * per keystroke, and the general version of this problem wants a dirty
   * flag rather than a broadcast save.
   */
  private async persistOtherSessions(
    actor: import("./world/session.js").SessionState,
  ): Promise<void> {
    if (!this.prisma || !this.world) return;
    for (const other of this.sessions.inRoom(actor.currentRoomId, actor.userId)) {
      if (!other.pendingPersist) continue;
      other.pendingPersist = false;
      const socket = this.socketByUserId.get(other.userId);
      const playerId = socket ? this.playerIdBySocket.get(socket) : undefined;
      if (!playerId) continue;
      try {
        await savePlayerState(this.prisma, playerId, other);
        // The victim's inventory and the floor move together, in ONE
        // transaction — a crash between them either duplicates what they
        // were carrying or destroys it, and there is no way to give it back.
        await applyDeathDrop(
          this.prisma,
          playerId,
          other.currentRoomId,
          this.world.getAllItemsInRoom(other.currentRoomId),
        );
      } catch {
        // Same reasoning as the main save path: a Postgres hiccup must not
        // kill anyone's connection. The next save retries.
      }
    }
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
      // Only the room the player is standing in can have changed — `get`,
      // `drop`, `hide` and `search` are the only verbs that move floor
      // contents, and all of them act here. Writing every room would be the
      // obvious way to make this too slow to keep.
      //
      // getAllItemsInRoom, NOT getItemsInRoom: the save is a delete-then-
      // insert of the whole room, so writing back only the VISIBLE stacks
      // would delete every hidden one on the next command any player typed.
      // Nothing would report an error; stashed items would simply stop
      // existing.
      // Inventory and floor together, in one transaction. `loot` moves a
      // whole pile between the two, and a crash between two separate writes
      // would duplicate it or destroy it.
      if (this.world) {
        await saveInventoryAndRoom(
          this.prisma,
          playerId,
          session.inventory,
          session.currentRoomId,
          this.world.getAllItemsInRoom(session.currentRoomId),
        );
      } else {
        await saveInventory(this.prisma, playerId, session.inventory);
      }
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
