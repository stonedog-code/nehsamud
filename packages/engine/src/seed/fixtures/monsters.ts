/**
 * Monster catalog. Spawned by Phase 5's mob-spawner; each fight
 * references this row for base stats and the alignment/mobType
 * axes that the combat AI keys off.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/mobs_monsters.py.
 * Focused-rewrite subset: the 8 monster slugs that the Python
 * world's encounter tables actually rolled. The other 12 monster
 * definitions in the Python file were unreachable from any spawn
 * point.
 */

import type { MonsterFixture } from "./types.js";

export const MONSTERS: MonsterFixture[] = [
  {
    slug: "goblin",
    name: "Goblin",
    description: "A wiry green creature with too many teeth and a rusty knife.",
    level: 1,
    baseHp: 8,
    baseDamage: 2,
    experience: 20,
    alignment: "evil",
    mobType: "humanoid",
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
    alignment: "neutral",
    mobType: "beast",
  },
  {
    slug: "wolf",
    name: "Wolf",
    description: "Lean, hungry, and unwilling to share the path.",
    level: 2,
    baseHp: 14,
    baseDamage: 3,
    experience: 35,
    alignment: "neutral",
    mobType: "beast",
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
    alignment: "evil",
    mobType: "undead",
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
    alignment: "evil",
    mobType: "undead",
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
    alignment: "evil",
    mobType: "humanoid",
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
    alignment: "evil",
    mobType: "humanoid",
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
    alignment: "neutral",
    mobType: "elemental",
  },
];
