/**
 * The character-creation axes THIS pack declares, and the choices on each.
 *
 * Two files used to live here — `races.ts` and `classes.ts` — mirroring two
 * hardcoded database tables. That arrangement decided, for every world the
 * engine would ever serve, that a character is built from exactly a race and
 * a class. A care-centre world has neither; a different fantasy pack might
 * want a third axis for a homeland. So the axes are declared here, as data,
 * and the engine only knows that a character picks one option per group.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud),
 * source_data/player_race.py and source_data/player_class.py.
 *
 * The race subset drops half-elf, gnome and tiefling, and the class subset
 * drops druid, monk, paladin, sorcerer and warlock: in the Python original
 * every one of them was a cosmetically-different human or warrior.
 */

import type { CharacterOptionGroupFixture } from "./types.js";

export const CHARACTER_OPTION_GROUPS: CharacterOptionGroupFixture[] = [
  {
    key: "race",
    name: "Race",
    description: "What you are. Sets the shape of your attributes before training.",
    position: 0,
    options: [
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
    ],
  },
  {
    key: "class",
    name: "Class",
    description: "What you trained as. Combines with your race to produce final attributes.",
    position: 1,
    options: [
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
    ],
  },
];
