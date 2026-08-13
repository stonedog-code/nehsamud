/**
 * Inventory arithmetic.
 *
 * Pure functions over a plain array, kept out of the handlers so the stacking
 * rules are tested once rather than reimplemented per verb — `get`, `drop`
 * and (later) `loot` and `equip` all need the same answers, and three
 * near-identical implementations is how quantities start disagreeing.
 */

import type { InventoryEntry } from "./session.js";

/**
 * Add to an inventory, merging into an existing stack.
 *
 * Mutates in place. The session owns the array and every caller holds the
 * same reference, so returning a new one would silently strand updates.
 */
export function addToInventory(
  inventory: InventoryEntry[],
  entry: InventoryEntry,
): void {
  if (entry.quantity <= 0) return;
  const existing = inventory.find((e) => e.itemId === entry.itemId);
  if (existing) {
    existing.quantity += entry.quantity;
    return;
  }
  inventory.push({ ...entry });
}

/**
 * Remove one of an item. Returns the entry as it was before, or undefined
 * when the player was not carrying it.
 *
 * Empty stacks are removed rather than left at zero — an inventory listing a
 * thing you have none of is a bug report waiting to happen.
 */
export function removeFromInventory(
  inventory: InventoryEntry[],
  itemId: string,
): InventoryEntry | undefined {
  const index = inventory.findIndex((e) => e.itemId === itemId);
  if (index === -1) return undefined;
  const entry = inventory[index]!;
  const before = { ...entry };
  entry.quantity -= 1;
  if (entry.quantity <= 0) inventory.splice(index, 1);
  return before;
}

/**
 * Find a carried item by name or a leading word of it, case-insensitively.
 *
 * Same matching as items on the floor, and that is the point: a player types
 * `drop rusty` having just typed `get rusty`, and the two must agree.
 */
export function findInInventory(
  inventory: InventoryEntry[],
  query: string,
): InventoryEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    inventory.find((e) => e.name.toLowerCase() === q) ??
    inventory.find((e) => e.name.toLowerCase().startsWith(q)) ??
    inventory.find((e) => e.name.toLowerCase().includes(q))
  );
}

/** Total number of things carried, counting stacks. */
export function inventoryCount(inventory: InventoryEntry[]): number {
  return inventory.reduce((total, e) => total + e.quantity, 0);
}
