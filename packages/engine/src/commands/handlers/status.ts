/**
 * Character-status verbs — `statistics`, `experience`, `rest`.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud),
 * core/commands/{statistics,experience,rest}.py.
 *
 * WHAT THE ORIGINALS COULD NOT TELL YOU, AND THIS DOES:
 *
 * The Python `experience` printed the raw total and stopped — "You have 240
 * experience." A number with no scale answers nothing a player actually
 * wants to know, which is how close they are to the next level. Now that
 * levelling exists (progression.ts), the distance is computable, so it is
 * shown.
 *
 * TWO DELIBERATE DEPARTURES:
 *
 *   - The original `statistics` listed attributes the schema does not have
 *     (`determination`, `faith`, `perception`) and omitted three it does
 *     (`wisdom`, `constitution`, `luck`). It was written against an older
 *     player model. This renders the seven columns that exist, so the sheet
 *     cannot show a stat nothing can ever change.
 *   - The original `rest` set `is_resting = True` and left the healing to a
 *     tick loop elsewhere. There is no tick loop here, and adding a
 *     background timer to make one verb work would put the engine's most
 *     testable property — that a command's effect is a pure function of the
 *     state it was given — behind a clock. So `rest` heals a fixed fraction
 *     per invocation instead. Repeating it is the recovery, which also makes
 *     it scriptable (`while hp < 50: rest`) in a way a timer would not be.
 */

import {
  MAX_LEVEL,
  levelForXp,
  xpForLevel,
  xpToNextLevel,
} from "../../progression.js";
import { equippedArmour, equippedWeapon } from "./equip.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/**
 * Fraction of maximum HP restored by one `rest`.
 *
 * A fraction rather than a flat number so recovery scales with the character
 * — otherwise resting to full takes a level-1 player two commands and a
 * level-100 player forty, and the verb becomes something you script around
 * rather than use.
 */
export const REST_FRACTION = 0.2;

/** Floor on a single rest, so a low-HP character is never told they healed 0. */
export const REST_MINIMUM = 1;

/** How much one `rest` restores for a given maximum. */
export function restAmount(maxHp: number): number {
  return Math.max(REST_MINIMUM, Math.floor(maxHp * REST_FRACTION));
}

export const statisticsHandler: CommandHandler = ({ session }) => {
  const sheet = session.sheet;
  const name = session.characterName ?? "Traveller";
  const level = levelForXp(session.experience);

  const lines = [
    `${name} — level ${level}`,
    sheet ? `${sheet.raceName} ${sheet.className}` : "Race and class unknown",
    `Health: ${session.currentHp} of ${session.maxHp}`,
    `Experience: ${session.experience}`,
  ];

  if (level < MAX_LEVEL) {
    lines.push(
      `Next level: ${xpToNextLevel(session.experience)} experience to level ${level + 1}`,
    );
  } else {
    lines.push("You have reached the highest level.");
  }

  if (sheet) {
    lines.push(
      "Attributes:",
      `  Strength ${sheet.strength}    Intelligence ${sheet.intelligence}`,
      `  Wisdom ${sheet.wisdom}    Charisma ${sheet.charisma}`,
      `  Constitution ${sheet.constitution}    Dexterity ${sheet.dexterity}`,
      `  Luck ${sheet.luck}`,
    );
  }

  // Equipment belongs on the character sheet: `statistics` is where a player
  // checks what they are before deciding whether to pick a fight.
  const weapon = equippedWeapon(session.inventory);
  const armour = equippedArmour(session.inventory);
  lines.push(
    weapon
      ? `Wielding: ${weapon.name} (+${weapon.damage} damage)`
      : "Wielding: nothing",
    armour
      ? `Wearing: ${armour.name} (${armour.protection} protection)`
      : "Wearing: nothing",
  );

  const conditions: string[] = [];
  if (session.defeated) conditions.push("defeated");
  if (session.resting) conditions.push("resting");
  lines.push(
    conditions.length
      ? `Condition: ${conditions.join(", ")}`
      : "Condition: healthy",
  );

  return reply(...lines);
};

export const experienceHandler: CommandHandler = ({ session }) => {
  const level = levelForXp(session.experience);
  if (level >= MAX_LEVEL) {
    return reply(
      `You have ${session.experience} experience, and stand at level ${MAX_LEVEL}. There is nothing further to earn.`,
    );
  }
  const remaining = xpToNextLevel(session.experience);
  const span = xpForLevel(level + 1) - xpForLevel(level);
  const earned = span - remaining;
  return reply(
    `You have ${session.experience} experience, at level ${level}.`,
    `${remaining} more to level ${level + 1} (${earned} of ${span} of the way there).`,
  );
};

export const restHandler: CommandHandler = ({ world, session }) => {
  if (session.defeated) {
    // Resting is not how you come back from being killed, and saying "you
    // rest" to a defeated player would imply it is.
    return reply("You are in no condition to rest. You are on the ground.");
  }

  // A monster in the room refuses the rest, exactly as the original did —
  // this is the one rule of the Python version worth keeping verbatim,
  // because it is what stops `rest` being a free heal mid-fight.
  const hostiles = world.getMonstersInRoom(session.currentRoomId);
  if (hostiles.length > 0) {
    session.resting = false;
    const who = hostiles.length === 1 ? hostiles[0]!.name : "something hostile";
    return reply(`You cannot rest with ${who} here.`);
  }

  if (session.currentHp >= session.maxHp) {
    session.resting = true;
    return reply("You settle down to rest. You are already at full health.");
  }

  const healed = Math.min(
    restAmount(session.maxHp),
    session.maxHp - session.currentHp,
  );
  session.currentHp += healed;
  session.resting = true;

  const lines = [`You rest, and recover ${healed} health.`];
  lines.push(
    session.currentHp >= session.maxHp
      ? "You are fully rested."
      : `Health: ${session.currentHp} of ${session.maxHp}`,
  );
  return reply(...lines);
};
