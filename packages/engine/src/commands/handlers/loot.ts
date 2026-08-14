/**
 * `loot <name>` — take everything a defeated player left behind.
 *
 * PRD-0001 makes this a PVP-mode mechanic and, deliberately, an OPTIONAL
 * one: killing someone does not hand you their belongings, it puts them on
 * the ground. Taking them is a separate act a player has to choose.
 *
 * AND ANYONE PRESENT MAY DO IT — not only whoever landed the last blow.
 * That is the requirement (NEH-624 §3) and it is the more interesting rule:
 * a pile on the ground is a thing to race for, to guard for a friend, or to
 * leave alone. Restricting it to the killer would make the corpse private
 * property, which is the opposite of what a contested world wants.
 *
 * Convenience, not capability. Everything a corpse holds is lying on the
 * floor and can be picked up one piece at a time with `get`; this takes the
 * lot in one command. That is why a lost corpse marker — a restart, say —
 * costs nothing but typing.
 */

import { addToInventory } from "../../world/inventory.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const lootHandler: CommandHandler = ({ world, session, command }) => {
  // The mode gate, read from the world rather than from anything a client
  // sent. `dispatch` also refuses the verb outright where looting is not
  // permitted; this is the second of the two independent guards, so a new
  // call site that forgets the first still cannot reach the mechanic.
  if (!world.capabilities.looting) {
    return reply("There is nothing to loot here.");
  }

  if (session.defeated) {
    return reply("You're on the ground yourself. Try `look` to recover.");
  }

  const query = command.rest.trim();
  if (!query) {
    const here = world.getCorpsesInRoom(session.currentRoomId);
    if (here.length === 0) {
      return reply("Loot what? There is nobody here to loot.");
    }
    return reply(
      `Loot what? You could loot: ${here.map((c) => c.ownerName).join(", ")}.`,
    );
  }

  const corpse = world.findCorpseInRoom(query, session.currentRoomId);
  if (!corpse) {
    return reply(`There's nothing here belonging to "${query}".`);
  }

  // Taken from the FLOOR, one stack at a time, because that is where the
  // items actually are. Anything already carried off by another player is
  // simply no longer there — the corpse records what was dropped, not what
  // is owed, so two players looting the same pile split it rather than
  // duplicating it.
  const taken: string[] = [];
  let count = 0;
  for (const entry of corpse.contents) {
    let moved = 0;
    for (let i = 0; i < entry.quantity; i += 1) {
      const stack = world.takeItemFromRoom(corpse.roomId, entry.itemId);
      if (!stack) break;
      const catalog = world.getItem(entry.itemId);
      addToInventory(session.inventory, {
        itemId: entry.itemId,
        name: stack.name,
        quantity: 1,
        type: catalog?.type,
        slot: catalog?.slot,
        baseValue: catalog?.baseValue,
      });
      moved += 1;
    }
    if (moved > 0) {
      taken.push(moved > 1 ? `${stackName(entry.name)} ×${moved}` : entry.name);
      count += moved;
    }
  }

  // The marker goes whether or not anything was left to take. A corpse that
  // yields nothing twice is a thing players learn to ignore, and then miss
  // the one that had something.
  world.removeCorpse(corpse.id);

  if (count === 0) {
    return reply(
      `${corpse.ownerName}'s belongings are already gone — somebody was here first.`,
    );
  }
  return reply(
    `You take ${taken.join(", ")} from ${corpse.ownerName}'s belongings.`,
  );
};

/** Item names are already display-ready; this is just where pluralising would go. */
function stackName(name: string): string {
  return name;
}
