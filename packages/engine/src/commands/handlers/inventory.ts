/**
 * `inventory` — list what the player is carrying.
 *
 * This was a stub that always answered "(empty — pickup/drop wires up in
 * Phase 7)". Phase 7 had landed; the stub had not been revisited, so the
 * command reported an empty bag to a player who was carrying things and
 * nothing indicated it was lying.
 */

import { inventoryCount } from "../../world/inventory.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const inventoryHandler: CommandHandler = ({ session }) => {
  if (session.inventory.length === 0) {
    return reply("You aren't carrying anything.");
  }

  const lines = ["You are carrying:"];
  for (const entry of session.inventory) {
    lines.push(
      entry.quantity > 1
        ? `  ${entry.name} (x${entry.quantity})`
        : `  ${entry.name}`,
    );
  }
  const total = inventoryCount(session.inventory);
  lines.push(`(${total} item${total === 1 ? "" : "s"} in total.)`);
  return reply(...lines);
};
