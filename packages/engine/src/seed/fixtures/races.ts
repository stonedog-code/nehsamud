/**
 * Playable race catalog. Stat modifiers apply at character
 * creation; abilities/directives are read by the Phase 4 command
 * processor + Phase 5 combat system.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/player_race.py
 * (Python legacy). Focused-rewrite subset: the four core races
 * plus a couple of less-common ones that already had distinct
 * play patterns in the Python game. Half-elf, gnome, and tiefling
 * dropped because the Python implementation just gave them
 * cosmetically-different humans.
 */

import type { RaceFixture } from "./types.js";

export const RACES: RaceFixture[] = [
  {
    slug: "human",
    name: "Human",
    description:
      "Adaptable and curious. Humans get a small generalist bonus instead of any one stat spike.",
    strengthMod: 1,
    intelligenceMod: 1,
    wisdomMod: 1,
    charismaMod: 1,
    constitutionMod: 1,
    dexterityMod: 1,
    luckMod: 1,
    abilities: ["versatile"],
    directives: ["explore", "trade"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "elf",
    name: "Elf",
    description:
      "Long-lived forest dwellers, lighter on their feet than they look.",
    strengthMod: 0,
    intelligenceMod: 2,
    wisdomMod: 1,
    charismaMod: 1,
    constitutionMod: -1,
    dexterityMod: 2,
    luckMod: 0,
    abilities: ["keen-sight", "ancient-tongue"],
    directives: ["explore"],
    baseExperienceAdjustment: 5,
  },
  {
    slug: "dwarf",
    name: "Dwarf",
    description:
      "Stout, stubborn, and remarkably hard to knock over. Excellent in confined spaces.",
    strengthMod: 2,
    intelligenceMod: 0,
    wisdomMod: 1,
    charismaMod: -1,
    constitutionMod: 2,
    dexterityMod: 0,
    luckMod: 0,
    abilities: ["stoneworker", "darkvision"],
    directives: ["mine", "smith"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "halfling",
    name: "Halfling",
    description:
      "Small, fast, hungry. Often underestimated, usually a mistake.",
    strengthMod: -1,
    intelligenceMod: 1,
    wisdomMod: 1,
    charismaMod: 2,
    constitutionMod: 0,
    dexterityMod: 3,
    luckMod: 2,
    abilities: ["nimble", "lucky"],
    directives: ["sneak", "snack"],
    baseExperienceAdjustment: 10,
  },
  {
    slug: "orc",
    name: "Orc",
    description:
      "Slab-shouldered, low-patience, and very good at hitting things. Disliked in most taverns.",
    strengthMod: 3,
    intelligenceMod: -1,
    wisdomMod: 0,
    charismaMod: -2,
    constitutionMod: 2,
    dexterityMod: 0,
    luckMod: 0,
    abilities: ["intimidate", "berserk"],
    directives: ["fight", "raid"],
    baseExperienceAdjustment: -5,
  },
  {
    slug: "half-orc",
    name: "Half-Orc",
    description:
      "Mixed parentage, mixed welcome. Bigger than humans, stealthier than orcs.",
    strengthMod: 2,
    intelligenceMod: 0,
    wisdomMod: 0,
    charismaMod: -1,
    constitutionMod: 2,
    dexterityMod: 1,
    luckMod: 0,
    abilities: ["endurance"],
    directives: ["fight"],
    baseExperienceAdjustment: 0,
  },
];
