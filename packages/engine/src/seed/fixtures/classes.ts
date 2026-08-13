/**
 * Playable class catalog. Same shape as races; combines with the
 * chosen race at character creation to produce final stats.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/player_class.py.
 * Focused-rewrite subset: warrior / mage / rogue / cleric (the
 * archetypes the demo wants), plus ranger + bard for variety.
 * Druid, monk, paladin, sorcerer, warlock dropped — the Python
 * implementation was the warrior with cosmetic dialog differences.
 */

import type { ClassFixture } from "./types.js";

export const CLASSES: ClassFixture[] = [
  {
    slug: "warrior",
    name: "Warrior",
    description: "Front-line fighter. High HP, weapon-focused.",
    strengthMod: 2,
    intelligenceMod: 0,
    wisdomMod: 0,
    charismaMod: 0,
    constitutionMod: 2,
    dexterityMod: 1,
    luckMod: 0,
    abilities: ["second-wind", "weapon-mastery"],
    directives: ["protect", "fight"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "mage",
    name: "Mage",
    description: "Glass cannon. Spells are loud, the spellbook is heavy.",
    strengthMod: -1,
    intelligenceMod: 3,
    wisdomMod: 2,
    charismaMod: 1,
    constitutionMod: -1,
    dexterityMod: 0,
    luckMod: 0,
    abilities: ["arcane-bolt", "mend"],
    directives: ["study", "ward"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "rogue",
    name: "Rogue",
    description: "Quiet, quick, opportunistic. Has opinions about locked doors.",
    strengthMod: 0,
    intelligenceMod: 1,
    wisdomMod: 0,
    charismaMod: 1,
    constitutionMod: 0,
    dexterityMod: 3,
    luckMod: 1,
    abilities: ["sneak-attack", "lockpick"],
    directives: ["sneak", "loot"],
    baseExperienceAdjustment: 5,
  },
  {
    slug: "cleric",
    name: "Cleric",
    description:
      "Carries a holy symbol and a heavy mace. Will absolutely heal you.",
    strengthMod: 1,
    intelligenceMod: 0,
    wisdomMod: 3,
    charismaMod: 1,
    constitutionMod: 1,
    dexterityMod: 0,
    luckMod: 0,
    abilities: ["heal", "turn-undead"],
    directives: ["heal", "protect"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "ranger",
    name: "Ranger",
    description:
      "A pathfinder who fights with a bow before anyone gets close enough to disagree.",
    strengthMod: 1,
    intelligenceMod: 0,
    wisdomMod: 2,
    charismaMod: 0,
    constitutionMod: 1,
    dexterityMod: 2,
    luckMod: 0,
    abilities: ["track", "ranged-shot"],
    directives: ["hunt", "scout"],
    baseExperienceAdjustment: 0,
  },
  {
    slug: "bard",
    name: "Bard",
    description:
      "Words first, lute second, blade somewhere down the list. Surprisingly competent.",
    strengthMod: 0,
    intelligenceMod: 1,
    wisdomMod: 1,
    charismaMod: 3,
    constitutionMod: 0,
    dexterityMod: 1,
    luckMod: 1,
    abilities: ["inspire", "charm"],
    directives: ["entertain", "persuade"],
    baseExperienceAdjustment: 5,
  },
];
