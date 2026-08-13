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
import { findArea } from "../../seed/fixtures/areas.js";
import { lookHandler } from "./look.js";

const VALID_DIRECTIONS = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

export const moveHandler: CommandHandler = async (ctx) => {
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
  const destination = ctx.world.getRoom(targetRoomId);
  ctx.session.currentRoomId = targetRoomId;
  // You cannot walk somewhere and still be sitting down. Clearing it here
  // rather than in `rest` is what keeps the flag honest: every way OUT of
  // resting has to clear it, and movement is the commonest one.
  ctx.session.resting = false;

  const looked = await lookHandler(ctx);

  // Announce the region only when it CHANGES. Putting the area on every room
  // title would be noise on 39 renders to carry information that matters on
  // four of them — and crossing out of the safe ring is exactly the moment a
  // player needs telling, because the next room is where the difficulty
  // steps up.
  if (destination && room.area !== destination.area) {
    const area = findArea(destination.area);
    if (area) {
      return {
        ...looked,
        lines: [`You have entered ${area.name}.`, ...looked.lines],
      };
    }
  }
  return looked;
};
