/**
 * `help` — print the verb cheat-sheet.
 *
 * Keep this in sync with the dispatcher's verb registry — if a
 * command lands without a help line, players don't discover it.
 *
 * The list is mode-aware for the same reason the registry is: advertising
 * `attack` in a world that has no combat teaches the player a command that
 * cannot work, and in the Exploration build it also contradicts the promise
 * the product is sold on.
 */

import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const helpHandler: CommandHandler = ({ world }) => {
  const lines = [
    "Available commands:",
    "  look (l)            — describe the room you're in",
    "  north / south /     — move that direction (also n / s / e / w / u / d)",
    "  east / west /",
    "  up / down",
    "  talk <npc>          — speak with an NPC in the room",
  ];

  if (world.capabilities.combat) {
    lines.push(
      "  attack <monster>    — strike a monster in the room (one round per command)",
    );
  }

  lines.push(
    "  get <item>          — pick something up off the floor",
    "  drop <item>         — put something down here",
    "  inventory (i)       — list what you're carrying",
    "  say (') <message>   — speak to everyone in this room",
    "  yell <message>      — speak loud enough for nearby rooms to hear",
    "  whisper (tell)      — speak privately to someone here",
    "    <who> <message>",
    "  who                 — list the players online",
    "  statistics (stats)  — your character sheet",
    "  experience (exp)    — how far you are from the next level",
    "  rest                — recover health, if nothing hostile is here",
    "  search (sea)        — look harder; some things are hidden",
    "  hide (stash) <item> — conceal something here, findable only by search",
    "  equip (eq, wield)   — wield or wear something you're carrying",
    "    <item>",
    "  unequip (remove)    — put equipped gear away",
    "    <item>",
    "  help (h, ?)         — show this list",
    "  quit (q)            — disconnect",
  );

  return reply(...lines);
};
