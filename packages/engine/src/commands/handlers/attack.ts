/**
 * `attack <target>` — one round of combat against a monster in
 * the current room.
 *
 * Resolution per command invocation:
 *   1. Player swings: monster takes `PLAYER_BASE_DAMAGE` damage
 *      (Phase 7 will add weapon + str-mod scaling once inventory
 *      and equipped-weapon tracking is wired).
 *   2. If the monster survives, it counter-attacks: player takes
 *      `monster.baseDamage` damage.
 *   3. Lines describe both swings + the surviving HP totals.
 *
 * End states:
 *   - Monster killed → +experience to the session, line announces
 *     the death and the XP gain.
 *   - Player killed → session.defeated=true; line tells the
 *     player they've been beaten. The next `look` triggers the
 *     respawn path in handlers/look (Phase 5 behavior: full HP
 *     + back to TOWNSMEE_TOWNSQUARE).
 */

import {
  MAX_LEVEL,
  awardExperience,
  xpToNextLevel,
} from "../../progression.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/** Single-swing damage the player deals. Phase 7 replaces this
 * with weapon baseValue + class strengthMod. */
export const PLAYER_BASE_DAMAGE = 5;

export const attackHandler: CommandHandler = ({ world, session, command }) => {
  if (session.defeated) {
    return reply(
      "You're on the ground. Try `look` to recover and respawn at the town square.",
    );
  }
  const target = command.args[0];
  if (!target) {
    return reply("Attack what?");
  }
  const monster = world.findMonsterInRoom(target, session.currentRoomId);
  if (!monster) {
    return reply(`There's no "${target}" here to attack.`);
  }

  const lines: string[] = [];

  // 1. Player swing.
  const remainingHp = world.damageMonster(monster.instanceId, PLAYER_BASE_DAMAGE);
  lines.push(
    `You strike the ${monster.name} for ${PLAYER_BASE_DAMAGE} damage.`,
  );
  if (remainingHp === 0) {
    const award = awardExperience(session.experience, monster.experience);
    session.experience = award.experience;
    session.level = award.level;

    lines.push(
      `The ${monster.name} falls. You gain ${monster.experience} XP. (${session.experience} total.)`,
    );

    if (award.leveledUp) {
      // Max HP rises and current HP rises with it, rather than the player
      // levelling up and still standing there nearly dead. The gain is a
      // reward; making them rest it off would make levelling feel like a
      // penalty at exactly the moment it should not.
      session.maxHp += award.maxHpGained;
      session.currentHp += award.maxHpGained;

      lines.push(
        award.levelsGained === 1
          ? `You have reached level ${award.level}!`
          : `You have reached level ${award.level}, gaining ${award.levelsGained} levels!`,
        `Maximum health is now ${session.maxHp}.`,
      );
      if (award.level < MAX_LEVEL) {
        lines.push(`${xpToNextLevel(session.experience)} XP to the next level.`);
      } else {
        lines.push("You have reached the highest level there is.");
      }
    }

    return reply(...lines);
  }
  lines.push(`The ${monster.name} has ${remainingHp}/${monster.maxHp} HP left.`);

  // 2. Monster counter-attack.
  const incoming = monster.baseDamage;
  session.currentHp = Math.max(0, session.currentHp - incoming);
  lines.push(
    `The ${monster.name} hits you for ${incoming} damage. (${session.currentHp}/${session.maxHp} HP.)`,
  );
  if (session.currentHp === 0) {
    session.defeated = true;
    lines.push(
      "You collapse. The world goes dark. (Type `look` to recover.)",
    );
  }
  return reply(...lines);
};
