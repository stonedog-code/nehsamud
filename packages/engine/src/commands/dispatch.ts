/**
 * Verb → handler dispatch.
 *
 * One canonical registry. Aliases are resolved by the parser
 * before they reach the dispatcher, so this map only carries the
 * canonical verb names.
 *
 * The registry is **mode-dependent**. Combat verbs are only present in a
 * world whose capabilities include combat, so in Exploration the handler is
 * not merely unadvertised — it is unreachable, and no combat span is ever
 * opened. This is the dispatcher half of the guard described in
 * `game-mode.ts`; the other half lives in `WorldState.spawnHostile`.
 */

import { COMBAT_VERBS, LOOTING_VERBS } from "../game-mode.js";
import { withSpan } from "../telemetry/spans.js";
import { attackHandler } from "./handlers/attack.js";
import { dropHandler } from "./handlers/drop.js";
import { getHandler } from "./handlers/get.js";
import { hideHandler, searchHandler } from "./handlers/conceal.js";
import { equipHandler, unequipHandler } from "./handlers/equip.js";
import { helpHandler } from "./handlers/help.js";
import { lootHandler } from "./handlers/loot.js";
import { inventoryHandler } from "./handlers/inventory.js";
import { lookHandler } from "./handlers/look.js";
import { moveHandler } from "./handlers/move.js";
import { quitHandler } from "./handlers/quit.js";
import {
  sayHandler,
  whisperHandler,
  whoHandler,
  yellHandler,
} from "./handlers/say.js";
import {
  experienceHandler,
  restHandler,
  statisticsHandler,
} from "./handlers/status.js";
import { talkHandler } from "./handlers/talk.js";
import type {
  CommandContext,
  CommandHandler,
  CommandResponse,
} from "./types.js";
import { reply } from "./types.js";

/** Verbs every world offers, whatever its mode. */
const BASE_HANDLERS: Record<string, CommandHandler> = {
  look: lookHandler,
  move: moveHandler,
  talk: talkHandler,
  inventory: inventoryHandler,
  get: getHandler,
  drop: dropHandler,
  say: sayHandler,
  yell: yellHandler,
  whisper: whisperHandler,
  who: whoHandler,
  statistics: statisticsHandler,
  experience: experienceHandler,
  rest: restHandler,
  search: searchHandler,
  hide: hideHandler,
  equip: equipHandler,
  unequip: unequipHandler,
  help: helpHandler,
  quit: quitHandler,
};

/** Verbs that only exist in a world with combat. Every key here must also
 * appear in `COMBAT_VERBS` so the refusal path recognises it. */
const COMBAT_HANDLERS: Record<string, CommandHandler> = {
  attack: attackHandler,
};

/**
 * Verbs that need LOOTING, which is narrower than combat.
 *
 * A separate table because the capabilities are separate: PVE has combat and
 * no looting, so a world can legitimately let you fight a goblin and never
 * offer to strip a body. Folding this into COMBAT_HANDLERS would give PVE a
 * verb its mode says it does not have.
 */
const LOOTING_HANDLERS: Record<string, CommandHandler> = {
  loot: lootHandler,
};

/**
 * The handler table for a mode.
 *
 * Built per call rather than cached: a world's mode is fixed for the
 * lifetime of the process, so this runs once per command on a table of
 * seven entries, and a cache keyed by mode would be a place for a stale
 * entry to hide for no measurable gain.
 */
export function handlersFor(
  capabilities: { combat: boolean; looting?: boolean },
): Record<string, CommandHandler> {
  return {
    ...BASE_HANDLERS,
    ...(capabilities.combat ? COMBAT_HANDLERS : {}),
    ...(capabilities.looting ? LOOTING_HANDLERS : {}),
  };
}

/**
 * What a player is told when they try to fight in a world without combat.
 *
 * Deliberately not the generic unknown-command reply. Someone typing
 * `attack` has a reasonable expectation that needs answering, and the
 * Exploration audience is the one least served by a message that reads like
 * they made a mistake. The handler is still unreachable — this is a string,
 * not a code path into combat.
 */
export const NO_COMBAT_MESSAGE =
  "There is no fighting in this world. Nothing here will harm you.";

/**
 * What a player is told when they try to loot in a world that does not.
 *
 * Distinct from the combat message because the situations are distinct: in
 * PVE you CAN fight, so "there is no fighting here" would be plainly false
 * and read as a bug.
 */
export const NO_LOOTING_MESSAGE =
  "Nothing here can be looted. Players keep what they carry in this world.";

/**
 * The dispatcher returns both a response (lines to send to the
 * client) AND a `closeSocket` flag set by the `quit` handler so
 * the ws-server layer can close after sending the farewell.
 */
export interface DispatchResult {
  response: CommandResponse;
  /** True when the caller should close the socket after sending
   * the response. Currently only `quit` sets this. */
  closeSocket: boolean;
}

export async function dispatch(ctx: CommandContext): Promise<DispatchResult> {
  const { verb } = ctx.command;
  if (verb === "") {
    return {
      response: reply(
        "What would you like to do? Type `help` for a list of commands.",
      ),
      closeSocket: false,
    };
  }
  // Combat is refused before the table is consulted, so the handler is
  // never resolved and `withSpan` never opens a combat span.
  const capabilities = ctx.world.capabilities;
  if (COMBAT_VERBS.has(verb) && !capabilities.combat) {
    return { response: reply(NO_COMBAT_MESSAGE), closeSocket: false };
  }
  // Looting is refused the same way and for the same reason: the verb is
  // answered rather than resolved, so the handler is unreachable in a world
  // whose mode does not permit it.
  if (LOOTING_VERBS.has(verb) && !capabilities.looting) {
    return { response: reply(NO_LOOTING_MESSAGE), closeSocket: false };
  }

  const handler = handlersFor(capabilities)[verb];
  if (!handler) {
    return {
      response: reply(
        `Unknown command "${verb}". Type \`help\` for a list of commands.`,
      ),
      closeSocket: false,
    };
  }
  // Trace when a tracer is provided; otherwise just await the
  // handler directly. Same behavior either way for callers.
  const run = async (): Promise<DispatchResult> => {
    const response = await handler(ctx);
    return { response, closeSocket: verb === "quit" };
  };
  if (ctx.tracer) {
    return withSpan(
      ctx.tracer,
      "mud.command.dispatch",
      {
        "mud.command.verb": verb,
        "mud.user.id": ctx.session.userId,
        "mud.room.id": ctx.session.currentRoomId,
      },
      run,
    );
  }
  return run();
}
