/**
 * Shapes shared across command handlers and the dispatcher.
 */

import type { Tracer } from "@opentelemetry/api";

import type { AiServices } from "../ai/factory.js";
import type { Rng } from "../combat.js";
import type { SessionRegistry, SessionState } from "../world/session.js";
import type { WorldState } from "../world/world-state.js";
import type { ParsedCommand } from "./parser.js";

/**
 * Context passed to every command handler. The handler reads /
 * mutates `session.currentRoomId` for navigation; everything else
 * is read-only from the handler's perspective.
 *
 * `ai` is optional — handlers that don't need LLM / image
 * generation ignore it. When unset (no provider key on this
 * deploy), handlers fall back to canned behavior.
 */
export interface CommandContext {
  world: WorldState;
  session: SessionState;
  /**
   * Every live session, for verbs that address other players.
   *
   * Optional so the great majority of handlers, and their tests, never think
   * about it. A communication verb without it degrades to "nobody else is
   * here" rather than throwing — the right failure for a transport-only test
   * harness.
   */
  sessions?: SessionRegistry;
  command: ParsedCommand;
  ai?: AiServices;
  /** Optional tracer. When unset, handlers skip span creation;
   * dispatch.ts wraps each command in a span when a tracer is
   * provided. */
  tracer?: Tracer;
  /**
   * Optional source of randomness for handlers that roll — combat today.
   *
   * Injected rather than reached for so a test can pin an exact sequence and
   * a reported fight is reproducible from its seed. When unset, the handler
   * seeds from the clock, which is right for production and useless for
   * assertions — which is exactly why tests must pass one.
   */
  rng?: Rng;
}

/**
 * Lines a handler wants to send back to the player. Multiple
 * lines so handlers can compose room render + status updates
 * without baking in the server frame format.
 */
/**
 * A message for players OTHER than the one who typed the command.
 *
 * Handlers stay pure: they describe who should hear what, and the ws layer
 * does the delivering. A handler holding sockets would make every
 * communication verb untestable without standing up a server, and would put
 * transport concerns in the one place that should only know about the game.
 */
export interface Broadcast {
  /**
   * `room`     — everyone in `roomId`, minus the speaker.
   * `adjacent` — everyone in a room directly connected to `roomId`.
   * `user`     — one player, by userId.
   */
  scope: "room" | "adjacent" | "user";
  message: string;
  /** Required for `room` and `adjacent`. */
  roomId?: string;
  /** Required for `user`. */
  userId?: string;
}

export interface CommandResponse {
  lines: string[];
  /**
   * What other players hear. Absent for the overwhelming majority of
   * commands, which only answer the person who typed them.
   */
  broadcasts?: Broadcast[];
}

/**
 * Handlers can be sync (the common case) or async (LLM-backed
 * paths). The dispatcher always awaits, so the union flows
 * through transparently.
 */
export type CommandHandler = (
  ctx: CommandContext,
) => CommandResponse | Promise<CommandResponse>;

export function reply(...lines: string[]): CommandResponse {
  return { lines };
}

/** A response that also reaches other players. */
export function replyWith(
  broadcasts: Broadcast[],
  ...lines: string[]
): CommandResponse {
  return { lines, broadcasts };
}
