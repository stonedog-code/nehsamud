/**
 * `drop <item>` — put something down in the current room.
 *
 * The other half of `get`. Together they are what makes the item system
 * reachable; either alone leaves an inventory that can only grow or only
 * shrink.
 *
 * A dropped item stays in the room — room contents persist, unlike monster
 * spawns — so this is how a player leaves something for someone else, and how
 * they will get their belongings back after a PVP loss (NEH-624).
 */

import { findInInventory, removeFromInventory } from "../../world/inventory.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const dropHandler: CommandHandler = ({ world, session, command }) => {
  if (session.defeated) {
    return reply("You're on the ground. Try `look` to recover first.");
  }

  const query = command.rest.trim();
  if (!query) {
    return reply("Drop what?");
  }

  const carried = findInInventory(session.inventory, query);
  if (!carried) {
    return reply(`You aren't carrying a "${query}".`);
  }

  const removed = removeFromInventory(session.inventory, carried.itemId);
  if (!removed) {
    return reply(`You aren't carrying a "${query}".`);
  }

  world.addItemToRoom(session.currentRoomId, removed.itemId, 1);

  return reply(`You drop the ${removed.name}.`);
};
