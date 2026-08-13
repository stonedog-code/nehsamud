/**
 * Concealment verbs — `search` and `hide`.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud),
 * core/commands/{search,hide}.py. They are one mechanic seen from both ends:
 * `hide` puts something where `look` will not report it, and `search` is the
 * only way to get it back. Shipping either alone would be half a feature —
 * a `search` with nothing to find, or a `hide` that is a delete.
 *
 * TWO SUBSTITUTIONS, MADE ON PURPOSE:
 *
 *   - The original rolls against `perception`, which is not one of this
 *     schema's seven attributes. `wisdom` is the nearest real column and is
 *     what is used here. Changing the attribute set to match the Python is
 *     the wrong direction: PRD-0002 is reshaping race/class anyway, and a
 *     column added to satisfy one roll is a column nothing else ever reads.
 *
 *   - The original computed `success = rand < perception / 100`, so a
 *     10-perception character found things 10% of the time and a
 *     100-perception one always did. With attributes centred near 10 that
 *     is a verb which fails nine times in ten, which is not a mechanic — it
 *     is a reason to type `search` ten times. The curve here starts at a
 *     usable base and treats the attribute as the edge, not the whole roll.
 */

import type { Rng } from "../../combat.js";
import { createRng } from "../../combat.js";
import { findInInventory, removeFromInventory } from "../../world/inventory.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/** Chance an average character finds what is there, before the attribute. */
export const BASE_SEARCH_CHANCE = 0.4;

/** Added per point of wisdom above the baseline, and subtracted below it. */
export const SEARCH_CHANCE_PER_WISDOM = 0.03;

/** Wisdom at which the base chance applies unmodified. */
export const SEARCH_BASELINE_WISDOM = 10;

/** Bounds, so no character ever always finds or never finds. */
export const MIN_SEARCH_CHANCE = 0.05;
export const MAX_SEARCH_CHANCE = 0.95;

/**
 * Probability that one `search` succeeds.
 *
 * Exported because a chance you cannot compute in a test is a chance nobody
 * can reason about — the balance conversation needs a number, not a feel.
 */
export function searchChance(wisdom: number): number {
  const raw =
    BASE_SEARCH_CHANCE +
    (wisdom - SEARCH_BASELINE_WISDOM) * SEARCH_CHANCE_PER_WISDOM;
  return Math.min(MAX_SEARCH_CHANCE, Math.max(MIN_SEARCH_CHANCE, raw));
}

export const searchHandler: CommandHandler = ({ world, session, rng }) => {
  if (session.defeated) {
    return reply("You are face down on the ground. You can't search from here.");
  }

  const roll: Rng = rng ?? createRng(Date.now());
  const wisdom = session.sheet?.wisdom ?? SEARCH_BASELINE_WISDOM;

  // The roll happens whether or not anything is hidden here, and it happens
  // FIRST. Rolling only when there is something to find would leak the
  // room's contents through the shape of the failure message — a player
  // could learn a room is empty without ever succeeding.
  const found = roll.next() < searchChance(wisdom);

  // Searching always ends a rest: you are up and turning the place over.
  session.resting = false;

  if (!found) {
    return reply("You search the room and find nothing.");
  }

  const revealed = world.revealHiddenItems(session.currentRoomId);
  if (revealed.length === 0) {
    return reply("After an exhaustive search, you find nothing and give up.");
  }

  const lines = ["Your search turns something up!"];
  for (const name of revealed) lines.push(`  You found ${name}!`);
  return reply(...lines);
};

export const hideHandler: CommandHandler = ({ world, session, command }) => {
  if (session.defeated) {
    return reply("You are in no state to hide anything.");
  }

  const query = command.rest.trim();

  // Bare `hide` in the original hid the PLAYER. That needs a stealth model —
  // what it conceals you from, what breaks it, whether a hidden player can
  // be whispered to — and inventing one inside an item verb is how a
  // mechanic ends up defined by its first caller. Refused explicitly rather
  // than silently doing nothing, so it reads as "not yet" and not as broken.
  if (!query) {
    return reply(
      "Hide what? (Hiding yourself isn't possible yet — name an item you're carrying.)",
    );
  }

  // Same matcher `drop` uses, so `hide rusty` finds whatever `get rusty`
  // picked up. A second, subtly different lookup here is how two verbs end
  // up disagreeing about what the player is holding.
  const carried = findInInventory(session.inventory, query);
  if (!carried) {
    return reply(`You aren't carrying a "${query}" to hide.`);
  }

  // One at a time, matching `drop`. Stashing a whole stack on one command is
  // the same surprise `get` avoids by taking one.
  removeFromInventory(session.inventory, carried.itemId);
  world.addItemToRoom(session.currentRoomId, carried.itemId, 1, true);

  return reply(
    `You conceal the ${carried.name} here. Only a search will turn it up now.`,
  );
};
