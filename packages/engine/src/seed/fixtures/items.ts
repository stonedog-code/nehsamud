/**
 * Item catalog — weapons, armor, consumables, lightsources, misc.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/weapon.py + armor.py
 * + food.py + lightsource.py. Item type IntEnum:
 *
 *   1 = weapon       baseValue = base damage
 *   2 = armor        baseValue = damage reduction
 *   3 = consumable   baseValue = null (effects are scripted)
 *   4 = lightsource  baseValue = burn duration in minutes
 *   5 = misc         baseValue = null
 *
 * Name is the application-layer key (uniqueness enforced by Prisma);
 * use a short Title Case label.
 */

import type { ItemFixture } from "./types.js";

export const ITEMS: ItemFixture[] = [
  /* ── Weapons ──────────────────────────────────────────────── */
  {
    name: "Short Sword",
    description: "A well-balanced blade, sharpened recently.",
    type: 1,
    slot: "weapon",
    baseValue: 8,
    weight: 3,
  },
  {
    name: "Long Sword",
    description: "Heavier, longer reach. The hilt is worn smooth from use.",
    type: 1,
    slot: "weapon",
    baseValue: 10,
    weight: 4,
  },
  {
    name: "Maul",
    description: "A two-handed warhammer with a slab of iron for a head.",
    type: 1,
    slot: "weapon",
    baseValue: 14,
    weight: 9,
  },
  {
    name: "Dagger",
    description: "Compact and quick. Doesn't weigh much in a boot sheath.",
    type: 1,
    slot: "weapon",
    baseValue: 5,
    weight: 1,
  },
  {
    name: "Quarterstaff",
    description: "Six feet of dense oak, iron-shod at both ends.",
    type: 1,
    slot: "weapon",
    baseValue: 7,
    weight: 4,
  },
  {
    name: "Shortbow",
    description: "Yew-wood bow, ranged combat. Comes with a quiver of arrows.",
    type: 1,
    slot: "weapon",
    baseValue: 6,
    weight: 2,
  },
  {
    name: "Wooden Stick",
    description: "Just a branch. Better than nothing.",
    type: 1,
    slot: "weapon",
    baseValue: 2,
    weight: 1,
  },

  /* ── Armor ────────────────────────────────────────────────── */
  {
    name: "Leather Helmet",
    description: "Hardened leather, somewhat sweat-stained.",
    type: 2,
    slot: "head",
    baseValue: 2,
    weight: 1,
  },
  {
    name: "Iron Helmet",
    description: "Rivets, nose-guard. Will deflect a glancing blow.",
    type: 2,
    slot: "head",
    baseValue: 4,
    weight: 3,
  },
  {
    name: "Wooden Shield",
    description: "Banded oak. Heavy but holds up.",
    type: 2,
    slot: "shield",
    baseValue: 3,
    weight: 5,
  },
  {
    name: "Iron Shield",
    description: "Round, riveted, with a leather grip on the inside.",
    type: 2,
    slot: "shield",
    baseValue: 5,
    weight: 8,
  },
  {
    name: "Leather Armor",
    description: "Stitched hide vest. Quiet, light.",
    type: 2,
    slot: "body",
    baseValue: 3,
    weight: 6,
  },
  {
    name: "Chainmail",
    description: "Interlinked iron rings; needs an oilcloth or it rusts.",
    type: 2,
    slot: "body",
    baseValue: 7,
    weight: 14,
  },

  /* ── Consumables (food + potions) ────────────────────────── */
  {
    name: "Loaf of Bread",
    description: "Stale, but edible.",
    type: 3,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Wedge of Cheese",
    description: "Yellow, sharp-smelling. Keeps in a pack for days.",
    type: 3,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Apple",
    description: "Red and firm.",
    type: 3,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Strip of Jerky",
    description: "Dried venison, salty and chewy.",
    type: 3,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Waterskin",
    description: "Leather bag of fresh water.",
    type: 3,
    baseValue: null,
    weight: 2,
  },
  {
    name: "Healing Potion",
    description: "A small clay vial. Tastes faintly of mint.",
    type: 3,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Antidote",
    description: "Sour, herbal. Counters most common poisons.",
    type: 3,
    baseValue: null,
    weight: 1,
  },

  /* ── Lightsources ─────────────────────────────────────────── */
  {
    name: "Torch",
    description: "Pitch-soaked rag wound on a stick. Burns about an hour.",
    type: 4,
    slot: "light",
    baseValue: 60,
    weight: 2,
  },
  {
    name: "Oil Lantern",
    description: "Brass-and-glass, refillable. Burns for hours.",
    type: 4,
    slot: "light",
    baseValue: 240,
    weight: 3,
  },
  {
    name: "Candle",
    description: "Beeswax. Brief, but the smoke is gentle.",
    type: 4,
    slot: "light",
    baseValue: 20,
    weight: 1,
  },

  /* ── Misc ─────────────────────────────────────────────────── */
  {
    name: "Coin Pouch",
    description: "A small leather pouch, jingles when shaken.",
    type: 5,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Iron Key",
    description: "Heavy, plain-headed. Fits something old.",
    type: 5,
    baseValue: null,
    weight: 1,
  },
  {
    name: "Rope (50ft)",
    description: "Tightly braided hemp. Holds plenty of weight.",
    type: 5,
    baseValue: null,
    weight: 4,
  },
  {
    name: "Bedroll",
    description: "Wool blanket and groundcloth, rolled and strapped.",
    type: 5,
    baseValue: null,
    weight: 5,
  },
];
