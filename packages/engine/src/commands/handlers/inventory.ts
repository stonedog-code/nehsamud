/**
 * `inventory` — list what the player is carrying.
 *
 * Phase 4 placeholder: returns "(empty)" because the Phase 7
 * persistence loop is what writes MudInventory rows in response
 * to pickup / drop events. We keep the command wired now so the
 * apps/web demo doesn't see "unknown command: inventory" when a
 * player tries it.
 */

import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const inventoryHandler: CommandHandler = () => {
  return reply(
    "Inventory:",
    "  (empty — pickup/drop wires up in Phase 7)",
  );
};
