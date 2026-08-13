/**
 * `equip` and `unequip` — deciding what the player is actually fighting with.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud),
 * core/commands/equip.py.
 *
 * THREE BUGS IN THE ORIGINAL, NOT PORTED:
 *
 *   - It dereferenced `found_item.item_type` in the deselect loop BEFORE the
 *     `if found_item is None` check below it. Equipping something you were
 *     not carrying raised AttributeError instead of refusing.
 *   - `found_item = True` was assigned and then immediately overwritten by
 *     `found_item = item`, so the boolean was dead code that only made the
 *     None-check look safe.
 *   - It matched on exact lowercase name only, while `get` and `drop` match
 *     on a prefix. `get rusty` worked and `equip rusty` did not, for the same
 *     item, in the same breath.
 *
 * ONE SLOT PER ITEM TYPE, which is the original's rule and also exactly what
 * the combat resolver models: `Combatant` has one `weapon` and one `armour`.
 * That does mean a helmet and a shield contend for the same slot today —
 * finer armour slots need a `slot` column AND a change to how the resolver
 * sums protection, so it is a follow-up rather than something to fake here.
 *
 * `unequip` has no counterpart in the original at all. Without it, equipping
 * is a one-way door: you can swap a sword for another sword but never fight
 * unarmed again. That is a gap, not a design.
 */

import { findInInventory } from "../../world/inventory.js";
import type { InventoryEntry } from "../../world/session.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/** Item types that can be worn or wielded. 3 = consumable, 5 = misc. */
export const EQUIPPABLE_TYPES: ReadonlySet<number> = new Set([
  1, // weapon
  2, // armour
  4, // lightsource
]);

/** Human name for a slot, for messages a player reads. */
export function slotName(type: number | undefined): string {
  switch (type) {
    case 1:
      return "weapon";
    case 2:
      return "armour";
    case 4:
      return "light";
    default:
      return "gear";
  }
}

/** The equipped entry for a slot, if any. */
export function equippedOfType(
  inventory: InventoryEntry[],
  type: number,
): InventoryEntry | undefined {
  return inventory.find((e) => e.equipped && e.type === type);
}

/** The equipped weapon, as the combat resolver wants it. */
export function equippedWeapon(
  inventory: InventoryEntry[],
): { name: string; damage: number } | undefined {
  const entry = equippedOfType(inventory, 1);
  if (!entry) return undefined;
  return { name: entry.name, damage: entry.baseValue ?? 0 };
}

/** The equipped armour, as the combat resolver wants it. */
export function equippedArmour(
  inventory: InventoryEntry[],
): { name: string; protection: number } | undefined {
  const entry = equippedOfType(inventory, 2);
  if (!entry) return undefined;
  return { name: entry.name, protection: entry.baseValue ?? 0 };
}

export const equipHandler: CommandHandler = ({ session, command }) => {
  if (session.defeated) {
    return reply("You're on the ground. Try `look` to recover first.");
  }

  const query = command.rest.trim();
  if (!query) {
    return reply("Equip what?");
  }

  // The same matcher `get`, `drop` and `hide` use. A verb with its own
  // lookup is a verb that disagrees with the others about what you hold.
  const entry = findInInventory(session.inventory, query);
  if (!entry) {
    return reply(`You aren't carrying a "${query}".`);
  }

  if (entry.type === undefined || !EQUIPPABLE_TYPES.has(entry.type)) {
    return reply(`You can't equip the ${entry.name}.`);
  }

  if (entry.equipped) {
    return reply(`You already have the ${entry.name} equipped.`);
  }

  const previous = equippedOfType(session.inventory, entry.type);
  entry.equipped = true;

  const lines: string[] = [];
  if (previous) {
    previous.equipped = false;
    lines.push(`You put away the ${previous.name}.`);
  }
  lines.push(`You equip the ${entry.name}.`);
  return reply(...lines);
};

export const unequipHandler: CommandHandler = ({ session, command }) => {
  const query = command.rest.trim();
  if (!query) {
    return reply("Unequip what?");
  }

  const entry = findInInventory(session.inventory, query);
  if (!entry) {
    return reply(`You aren't carrying a "${query}".`);
  }
  if (!entry.equipped) {
    return reply(`The ${entry.name} isn't equipped.`);
  }

  entry.equipped = false;
  return reply(`You put away the ${entry.name}.`);
};
