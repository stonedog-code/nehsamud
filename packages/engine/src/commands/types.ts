/**
 * Shapes shared across command handlers and the dispatcher.
 */

import type { Tracer } from "@opentelemetry/api";

import type { AiServices } from "../ai/factory.js";
import type { SessionState } from "../world/session.js";
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
  command: ParsedCommand;
  ai?: AiServices;
  /** Optional tracer. When unset, handlers skip span creation;
   * dispatch.ts wraps each command in a span when a tracer is
   * provided. */
  tracer?: Tracer;
}

/**
 * Lines a handler wants to send back to the player. Multiple
 * lines so handlers can compose room render + status updates
 * without baking in the server frame format.
 */
export interface CommandResponse {
  lines: string[];
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
