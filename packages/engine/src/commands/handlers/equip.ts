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
 * ONE EQUIPPED ITEM PER SLOT. It used to be one per item TYPE, which was the
 * original's rule and also what the combat resolver modelled — and because
 * every piece of armour shares one type, putting on a helmet took off your
 * shield. A character could wear exactly one piece of armour.
 *
 * The fix had to be two changes at once, or it would have been a lie: the
 * slot column alone would let five pieces be equipped while the resolver
 * still read one, producing a character sheet that lists four pieces of
 * armour and applies the protection of one. That looks like it works, which
 * is worse than the honest single slot. So `resolveAttack` sums protection
 * across worn pieces in the same change (NEH-658).
 *
 * `unequip` has no counterpart in the original at all. Without it, equipping
 * is a one-way door: you can swap a sword for another sword but never fight
 * unarmed again. That is a gap, not a design.
 */

import { findInInventory } from "../../world/inventory.js";
import type { InventoryEntry } from "../../world/session.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/**
 * The slot a weapon goes in.
 *
 * The one slot name the engine knows, because combat has to find the thing
 * you are swinging. Every other slot is pack data the engine never reads —
 * it only enforces one item per slot, whatever the slots are called.
 */
export const WEAPON_SLOT = "weapon";

/** Whether an item can be equipped at all. Slotless items cannot. */
export function isEquippable(entry: InventoryEntry): boolean {
  return typeof entry.slot === "string" && entry.slot.length > 0;
}

/** The equipped entry occupying a slot, if any. */
export function equippedInSlot(
  inventory: InventoryEntry[],
  slot: string,
): InventoryEntry | undefined {
  return inventory.find((e) => e.equipped && e.slot === slot);
}

/** The equipped weapon, as the combat resolver wants it. */
export function equippedWeapon(
  inventory: InventoryEntry[],
): { name: string; damage: number } | undefined {
  const entry = equippedInSlot(inventory, WEAPON_SLOT);
  if (!entry) return undefined;
  return { name: entry.name, damage: entry.baseValue ?? 0 };
}

/**
 * Every worn piece that protects, as the combat resolver wants them.
 *
 * A LIST, not one piece. The resolver sums across it — that is the half of
 * this change that makes the other half honest. Ordered by slot name so a
 * character sheet reads the same way twice running.
 *
 * The weapon slot is excluded: what you are swinging is not what you are
 * wearing, and counting a sword's damage as protection would be an
 * arithmetic accident rather than a rule. Anything else with a protection
 * value counts, so a pack adding a "cloak" slot needs no engine change.
 */
export function equippedArmour(
  inventory: InventoryEntry[],
): Array<{ name: string; protection: number }> {
  return inventory
    .filter(
      (e) =>
        e.equipped &&
        typeof e.slot === "string" &&
        e.slot !== WEAPON_SLOT &&
        (e.baseValue ?? 0) > 0,
    )
    .sort((a, b) => (a.slot ?? "").localeCompare(b.slot ?? ""))
    .map((e) => ({ name: e.name, protection: e.baseValue ?? 0 }));
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

  if (!isEquippable(entry)) {
    return reply(`You can't equip the ${entry.name}.`);
  }

  if (entry.equipped) {
    return reply(`You already have the ${entry.name} equipped.`);
  }

  // Only the piece in the SAME slot comes off. This is the whole fix: a
  // helmet no longer displaces a shield, because they no longer share a
  // place to be.
  const previous = equippedInSlot(session.inventory, entry.slot!);
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
