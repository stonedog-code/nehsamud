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
  createRng,
  describeAttack,
  resolveAttack,
  type Combatant,
} from "../../combat.js";
import {
  MAX_LEVEL,
  awardExperience,
  xpToNextLevel,
} from "../../progression.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

/**
 * Unarmed damage before weapon, level scaling and variance.
 *
 * Still a constant, but it is now the *floor* of a roll rather than the whole
 * answer — the resolver adds level scaling, the weapon, and a spread. Kept
 * exported because tests and balance work both want it named.
 */
export const PLAYER_BASE_DAMAGE = 5;

export const attackHandler: CommandHandler = ({
  world,
  session,
  command,
  rng,
}) => {
  if (session.defeated) {
    return reply(
      "You're on the ground. Try `look` to recover and respawn at the town square.",
    );
  }
  const target = command.args[0];
  if (!target) {
    return reply("Attack what?");
  }
  // Swinging at something ends the rest, whether or not the swing lands.
  session.resting = false;
  const monster = world.findMonsterInRoom(target, session.currentRoomId);
  if (!monster) {
    return reply(`There's no "${target}" here to attack.`);
  }

  const lines: string[] = [];

  // One RNG for the whole round, so the player's swing and the counter-attack
  // draw from the same sequence — two independent generators would make a
  // seeded test assert against an order that does not exist in production.
  const roll = rng ?? createRng(Date.now());

  const player: Combatant = {
    name: "you",
    level: session.level,
    baseDamage: PLAYER_BASE_DAMAGE,
    // Weapon and armour are absent until equipment lands (NEH-625). The
    // resolver already accepts them, so that is a wiring change rather than
    // a formula change.
  };
  const foe: Combatant = {
    name: monster.name,
    level: 1,
    baseDamage: monster.baseDamage,
  };

  // 1. Player swing.
  const swing = resolveAttack(player, foe, roll);
  const remainingHp = swing.hit
    ? world.damageMonster(monster.instanceId, swing.damage)
    : monster.currentHp;
  lines.push(
    describeAttack("You", `the ${monster.name}`, swing, {
      secondPerson: true,
    }),
  );
  if (swing.hit && remainingHp === 0) {
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

  // 2. Counter-attack, resolved by the same rules and the same RNG.
  const counter = resolveAttack(foe, player, roll);
  session.currentHp = Math.max(0, session.currentHp - counter.damage);
  lines.push(
    counter.hit
      ? `${describeAttack(`The ${monster.name}`, "you", counter)} (${session.currentHp}/${session.maxHp} HP.)`
      : `The ${monster.name} swings at you and misses.`,
  );
  if (session.currentHp === 0) {
    session.defeated = true;
    lines.push(
      "You collapse. The world goes dark. (Type `look` to recover.)",
    );
  }
  return reply(...lines);
};
