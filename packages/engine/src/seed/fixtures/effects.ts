/**
 * Status effect catalog — TS-only data, not persisted to mud.*.
 *
 * Phase 5's combat system applies these to a per-fight in-memory
 * buff/debuff list keyed by the player/monster id; effects expire
 * when their `durationRounds` countdown hits zero (or the fight
 * ends). The Python codebase shipped this as a DB table; the
 * focused rewrite drops the table because effects only matter for
 * an active fight and live-restart persistence isn't worth the
 * complexity.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/effects.py.
 */

import type { EffectFixture } from "./types.js";

export const EFFECTS: EffectFixture[] = [
  {
    slug: "poisoned",
    name: "Poisoned",
    description: "Slow-acting venom in the bloodstream. Loses HP each round.",
    category: "dot",
    durationRounds: 5,
    perRoundValue: -2,
  },
  {
    slug: "burning",
    name: "Burning",
    description: "Skin or clothes on fire. Takes ongoing fire damage.",
    category: "dot",
    durationRounds: 3,
    perRoundValue: -4,
  },
  {
    slug: "bleeding",
    name: "Bleeding",
    description: "Open wound. Loses a little HP each round until bandaged.",
    category: "dot",
    durationRounds: 4,
    perRoundValue: -1,
  },
  {
    slug: "regenerating",
    name: "Regenerating",
    description: "Magical or natural fast-healing. Gains HP each round.",
    category: "hot",
    durationRounds: 5,
    perRoundValue: 3,
  },
  {
    slug: "blessed",
    name: "Blessed",
    description: "Holy favor. +2 to attack rolls for the duration.",
    category: "buff",
    durationRounds: 6,
    perRoundValue: 2,
  },
  {
    slug: "weakened",
    name: "Weakened",
    description: "Sapped strength. -2 to attack rolls for the duration.",
    category: "debuff",
    durationRounds: 4,
    perRoundValue: -2,
  },
  {
    slug: "shielded",
    name: "Shielded",
    description: "Arcane barrier absorbs the next hit each round.",
    category: "buff",
    durationRounds: 3,
    perRoundValue: null,
  },
  {
    slug: "stunned",
    name: "Stunned",
    description: "Cannot act this round. Recovers automatically next round.",
    category: "control",
    durationRounds: 1,
    perRoundValue: null,
  },
  {
    slug: "frightened",
    name: "Frightened",
    description: "Penalty to attack and dexterity rolls until the source is out of sight.",
    category: "control",
    durationRounds: 3,
    perRoundValue: -1,
  },
  {
    slug: "rested",
    name: "Rested",
    description: "Out-of-combat recovery. Restores HP slowly each round.",
    category: "hot",
    durationRounds: -1,
    perRoundValue: 1,
  },
];
