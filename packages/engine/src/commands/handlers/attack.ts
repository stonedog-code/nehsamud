/**
 * `attack <target>` — one round of combat against a hostile in
 * the current room.
 *
 * Resolution per command invocation:
 *   1. Player swings: hostile takes damage derived from the player's
 *      strength (see character.ts), their weapon, level and a spread
 *      (Phase 7 will add weapon + str-mod scaling once inventory
 *      and equipped-weapon tracking is wired).
 *   2. If the hostile survives, it counter-attacks: player takes
 *      `hostile.baseDamage` damage.
 *   3. Lines describe both swings + the surviving HP totals.
 *
 * End states:
 *   - Hostile killed → +experience to the session, line announces
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
  BASE_ATTRIBUTE,
  BASE_PLAYER_DAMAGE,
  baseDamageFor,
} from "../../character.js";
import {
  MAX_LEVEL,
  awardExperience,
  xpToNextLevel,
} from "../../progression.js";
import type { CommandHandler } from "../types.js";
import { equippedArmour, equippedWeapon } from "./equip.js";
import { reply } from "../types.js";

/**
 * Unarmed damage before weapon, level scaling and variance.
 *
 * Still a constant, but it is now the *floor* of a roll rather than the whole
 * answer — the resolver adds level scaling, the weapon, and a spread. Kept
 * exported because tests and balance work both want it named.
 */
/**
 * @deprecated Unarmed damage is derived from strength now — see
 * `baseDamageFor` in character.ts. Kept as the *baseline* value (what a
 * character of average strength swings for) because tests and fixtures
 * reference it, and re-pointing it at the real constant is what stops the
 * two drifting into disagreement.
 */
export const PLAYER_BASE_DAMAGE = BASE_PLAYER_DAMAGE;

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
  const hostile = world.findHostileInRoom(target, session.currentRoomId);
  if (!hostile) {
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
    // Derived from strength, not a flat constant. This was
    // `PLAYER_BASE_DAMAGE` for every player regardless of who they were.
    baseDamage: baseDamageFor(session.sheet?.strength ?? BASE_ATTRIBUTE),
    // What the player has actually equipped. Until this line existed, `equip`
    // changed a flag and nothing else — the item system's whole point is that
    // a better sword hits harder, and a decorative equip is the kind of
    // feature that looks shipped and does nothing.
    weapon: equippedWeapon(session.inventory),
    armour: equippedArmour(session.inventory),
  };
  const foe: Combatant = {
    name: hostile.name,
    level: 1,
    baseDamage: hostile.baseDamage,
  };

  // 1. Player swing.
  const swing = resolveAttack(player, foe, roll);
  const remainingHp = swing.hit
    ? world.damageHostile(hostile.instanceId, swing.damage)
    : hostile.currentHp;
  lines.push(
    describeAttack("You", `the ${hostile.name}`, swing, {
      secondPerson: true,
    }),
  );
  if (swing.hit && remainingHp === 0) {
    const award = awardExperience(
      session.experience,
      hostile.experience,
      // Constitution scales the per-level HP gain, so a Dwarf Warrior pulls
      // further ahead of a Halfling Mage with every level rather than
      // keeping a fixed lead that is noise by level 100.
      session.sheet?.constitution,
    );
    session.experience = award.experience;
    session.level = award.level;

    lines.push(
      `The ${hostile.name} falls. You gain ${hostile.experience} XP. (${session.experience} total.)`,
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
  lines.push(`The ${hostile.name} has ${remainingHp}/${hostile.maxHp} HP left.`);

  // 2. Counter-attack, resolved by the same rules and the same RNG.
  const counter = resolveAttack(foe, player, roll);
  session.currentHp = Math.max(0, session.currentHp - counter.damage);
  lines.push(
    counter.hit
      ? `${describeAttack(`The ${hostile.name}`, "you", counter)} (${session.currentHp}/${session.maxHp} HP.)`
      : `The ${hostile.name} swings at you and misses.`,
  );
  if (session.currentHp === 0) {
    session.defeated = true;
    lines.push(
      "You collapse. The world goes dark. (Type `look` to recover.)",
    );
  }
  return reply(...lines);
};
