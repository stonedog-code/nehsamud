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
  type Rng,
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
import type {
  Broadcast,
  CommandHandler,
  CommandResponse,
} from "../types.js";
import type { SessionRegistry, SessionState } from "../../world/session.js";
import type { WorldState } from "../../world/world-state.js";
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
  sessions,
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

  // Players first, but ONLY where the mode allows it. In PVE and Exploration
  // another player is not a target at all, so the name falls through to the
  // hostile lookup and is answered with "there's no X here" — the same
  // message as any other miss. Naming them as an unattackable player would
  // advertise a mechanic this world does not have.
  if (world.capabilities.playerVersusPlayer && sessions) {
    const victim = findPlayerTarget(sessions, session, target);
    if (victim) {
      return attackPlayer(world, session, victim, rng);
    }
  }

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


/* ── Player versus player ─────────────────────────────────────────
 *
 * PRD-0001: PVP is a MODE, and the mode is resolved at boot from the
 * environment and attached to the world. So every guard here reads
 * `world.capabilities`, never anything a client sent — a player cannot ask
 * to be in a world that permits this.
 */

/** Another player in this room, addressable by character name. */
function findPlayerTarget(
  sessions: SessionRegistry,
  attacker: SessionState,
  query: string,
): SessionState | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return sessions
    .inRoom(attacker.currentRoomId, attacker.userId)
    .find(
      (s) =>
        s.characterName?.toLowerCase() === needle ||
        s.characterName?.toLowerCase().startsWith(needle),
    );
}

/**
 * One round against another player.
 *
 * Deliberately NOT symmetrical with the hostile path: there is no
 * counter-attack. A monster swings back because it has no other way to act;
 * another player does, and hitting them automatically on their behalf would
 * take the fight out of their hands — including the choice to run. They are
 * told they were hit and can answer however they like.
 */
function attackPlayer(
  world: WorldState,
  attacker: SessionState,
  victim: SessionState,
  rng: Rng | undefined,
): CommandResponse {
  const name = victim.characterName ?? "someone";
  if (victim.defeated) {
    return reply(`${name} is already on the ground.`);
  }

  const roll = rng ?? createRng(Date.now());
  const me: Combatant = {
    name: "you",
    level: attacker.level,
    baseDamage: baseDamageFor(attacker.sheet?.strength ?? BASE_ATTRIBUTE),
    weapon: equippedWeapon(attacker.inventory),
    armour: equippedArmour(attacker.inventory),
  };
  const them: Combatant = {
    name,
    level: victim.level,
    baseDamage: baseDamageFor(victim.sheet?.strength ?? BASE_ATTRIBUTE),
    weapon: equippedWeapon(victim.inventory),
    // The victim's armour counts. Attacking someone in full plate has to be
    // different from attacking someone in a shirt, or equipment is only a
    // mechanic when a monster is on the other end of it.
    armour: equippedArmour(victim.inventory),
  };

  const swing = resolveAttack(me, them, roll);
  victim.currentHp = Math.max(0, victim.currentHp - swing.damage);

  const lines: string[] = [
    describeAttack("You", name, swing, { secondPerson: true }),
  ];
  const broadcasts: Broadcast[] = [
    {
      scope: "user",
      userId: victim.userId,
      message: swing.hit
        ? `${attacker.characterName ?? "Someone"} hits you for ${swing.damage}. (${victim.currentHp}/${victim.maxHp} HP.)`
        : `${attacker.characterName ?? "Someone"} swings at you and misses.`,
    },
  ];

  if (victim.currentHp > 0) {
    lines.push(`${name} has ${victim.currentHp}/${victim.maxHp} HP left.`);
    return { lines, broadcasts };
  }

  /* ── The victim is down ────────────────────────────────────── */

  victim.defeated = true;
  victim.resting = false;
  // The server writes their row back after this dispatch — see
  // `persistOtherSessions`. They did not type this command, so nothing else
  // would.
  victim.pendingPersist = true;

  // Everything they carried goes on the floor as a marked pile. It is NOT
  // handed to the winner: PRD-0001 makes looting a choice, and any player
  // present may make it — including the victim's friend, or the victim
  // themselves once they are back on their feet.
  const corpse = world.dropCorpse(
    victim.currentRoomId,
    name,
    victim.inventory.map((e) => ({ itemId: e.itemId, quantity: e.quantity })),
  );
  victim.inventory = [];

  lines.push(`${name} collapses.`);
  broadcasts.push({
    scope: "user",
    userId: victim.userId,
    message: "You collapse. The world goes dark. (Type `look` to recover.)",
  });
  if (corpse) {
    lines.push(
      `Their belongings spill across the ground. (\`loot ${name}\` to take them.)`,
    );
    broadcasts.push({
      scope: "room",
      roomId: victim.currentRoomId,
      message: `${name} falls, and their belongings spill across the ground.`,
    });
  }

  // NO EXPERIENCE FOR A KILL. Awarding it would make hunting other players
  // the fastest way to level, which turns a mode into a farm — and the
  // people farmed would be the ones with the least reason to stay. What the
  // winner gets is the loot, which is what the mode is about.
  return { lines, broadcasts };
}
