/**
 * `move <direction>` — change the session's current room.
 *
 * Bare-direction shortcuts (`north`, `n`, etc.) are normalized
 * to `move <direction>` by the parser, so this handler is the
 * single entrypoint for navigation.
 *
 * On success: lookHandler is reused to render the destination
 * (look-after-move keeps the wire shape consistent with the
 * Python MUD's behavior).
 */

import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";
import { lookHandler } from "./look.js";

const VALID_DIRECTIONS = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

export const moveHandler: CommandHandler = (ctx) => {
  const direction = ctx.command.args[0]?.toLowerCase();
  if (!direction) {
    return reply("Move which direction? Try `north`, `south`, `east`, `west`, `up`, or `down`.");
  }
  if (!VALID_DIRECTIONS.has(direction)) {
    return reply(
      `"${direction}" isn't a direction you can travel. Valid: north/south/east/west/up/down.`,
    );
  }
  const room = ctx.world.getRoom(ctx.session.currentRoomId);
  if (!room) {
    return reply(
      "You're in a featureless void. (Bug: current room missing.)",
    );
  }
  const targetRoomId = room.exits[direction];
  if (!targetRoomId) {
    return reply(`You can't go ${direction} from here.`);
  }
  ctx.session.currentRoomId = targetRoomId;
  return lookHandler(ctx);
};
