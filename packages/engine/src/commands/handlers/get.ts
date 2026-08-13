/**
 * `get <item>` — pick something up off the floor.
 *
 * Half of the pair that makes the item system reachable at all. Items, room
 * drops and inventories were seeded, migrated and modelled, and with no `get`
 * and no `drop` a player's inventory could never change — the whole subsystem
 * was built and unreachable.
 *
 * One at a time, deliberately. `get coins` silently pocketing an entire stack
 * is the kind of thing a player notices only after it is gone.
 */

import { addToInventory } from "../../world/inventory.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const getHandler: CommandHandler = ({ world, session, command }) => {
  if (session.defeated) {
    return reply("You're on the ground. Try `look` to recover first.");
  }

  const query = command.rest.trim();
  if (!query) {
    return reply("Get what?");
  }

  const stack = world.findItemInRoom(query, session.currentRoomId);
  if (!stack) {
    return reply(`There's no "${query}" here to pick up.`);
  }

  const taken = world.takeItemFromRoom(session.currentRoomId, stack.itemId);
  if (!taken) {
    // Only reachable if the room changed between the find and the take. It
    // cannot today — command handling is single-threaded per process — but
    // reporting it beats returning a success the player can't verify.
    return reply(`The ${stack.name} is no longer there.`);
  }

  // Type and base value ride along from the catalog so `equip` and the
  // combat wiring can read them without a lookup on every swing.
  const catalog = world.getItem(taken.itemId);
  addToInventory(session.inventory, {
    itemId: taken.itemId,
    name: taken.name,
    quantity: 1,
    type: catalog?.type,
    baseValue: catalog?.baseValue,
  });

  return reply(`You pick up the ${taken.name}.`);
};
