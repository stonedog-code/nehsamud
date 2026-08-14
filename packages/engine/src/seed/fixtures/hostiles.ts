/**
 * The things in THIS pack that can be fought.
 *
 * "Hostile" rather than "hostile" because the engine serves worlds that have
 * no hostiles in them: what a thing IS belongs to the pack, and the only
 * mechanic here is that a player can attack it. A world with nothing to
 * fight — the care-centre one runs Exploration mode — simply ships none.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/mobs_hostiles.py.
 * Focused-rewrite subset: the 8 slugs that the Python world's encounter
 * tables actually rolled. The other 12 definitions in the Python file were
 * unreachable from any spawn point.
 *
 * `tags` replaced two enum columns, `alignment` and `mobType`. The engine
 * reads neither and never did — the comment claiming a combat AI keyed off
 * them described something that does not exist. They are kept as tags
 * because they describe this pack's content usefully, not because any rule
 * consults them.
 */

import type { HostileFixture } from "./types.js";

export const HOSTILES: HostileFixture[] = [
  {
    slug: "goblin",
    name: "Goblin",
    description: "A wiry green creature with too many teeth and a rusty knife.",
    level: 1,
    baseHp: 8,
    baseDamage: 2,
    experience: 20,
    tags: ["humanoid", "evil"],
  },
  {
    slug: "giant-rat",
    name: "Giant Rat",
    description:
      "About the size of a small dog. Its eyes glint yellow in the dark and it does not seem afraid.",
    level: 1,
    baseHp: 5,
    baseDamage: 1,
    experience: 10,
    tags: ["beast", "neutral"],
  },
  {
    slug: "wolf",
    name: "Wolf",
    description: "Lean, hungry, and unwilling to share the path.",
    level: 2,
    baseHp: 14,
    baseDamage: 3,
    experience: 35,
    tags: ["beast", "neutral"],
  },
  {
    slug: "skeleton",
    name: "Skeleton",
    description:
      "Loose-jointed and bone-white, picking its way forward with a rusted sword in hand. Empty " +
      "sockets watch you.",
    level: 3,
    baseHp: 18,
    baseDamage: 4,
    experience: 45,
    tags: ["undead", "evil"],
  },
  {
    slug: "zombie",
    name: "Zombie",
    description:
      "Bloated and slow, with a smell that makes your eyes water. It groans as it sees you.",
    level: 3,
    baseHp: 22,
    baseDamage: 3,
    experience: 40,
    tags: ["undead", "evil"],
  },
  {
    slug: "bandit",
    name: "Bandit",
    description:
      "A leather-armored rough with a hand axe and a wary stance. Looks for a purse to cut.",
    level: 3,
    baseHp: 20,
    baseDamage: 5,
    experience: 55,
    tags: ["humanoid", "evil"],
  },
  {
    slug: "ogre",
    name: "Ogre",
    description:
      "Nine feet of slack-jawed muscle hauling a tree-trunk club. Slow, but each hit is decisive.",
    level: 5,
    baseHp: 45,
    baseDamage: 8,
    experience: 120,
    tags: ["humanoid", "evil"],
  },
  {
    slug: "fire-elemental",
    name: "Fire Elemental",
    description:
      "A whirling column of flame, blue-white at the core. It pulses brighter when it sees a target.",
    level: 6,
    baseHp: 40,
    baseDamage: 10,
    experience: 180,
    tags: ["elemental", "neutral"],
  },
];
