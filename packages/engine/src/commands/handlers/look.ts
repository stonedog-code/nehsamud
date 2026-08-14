/**
 * `look` — render the current room.
 *
 * Output shape:
 *   <Room name>
 *   <Room description>
 *   You see here: <npc names>      (only when at least one NPC)
 *   Hostiles here: <hostile names + HP> (only when at least one)
 *   Exits: <direction list>         (only when at least one exit)
 *
 * Auto-respawn: if the session is in a `defeated` state when the
 * player runs `look`, restore full HP and move them back to the
 * spawn room before rendering. Matches Phase 5's "next input
 * after death respawns" contract that the attack handler refers
 * to in its defeated-line message.
 *
 * Phase 4 didn't show items-in-room — Phase 7 wires drop/pickup
 * against the existing MudRoomItem schema.
 */

import type { CachedRoom, WorldState } from "../../world/world-state.js";
import { sortDirections } from "../parser.js";
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

const SPAWN_ROOM_ENUM_KEY = "TOWNSMEE_TOWNSQUARE";

function renderRoom(world: WorldState, room: CachedRoom): string[] {
  const lines = [room.name, room.description];
  const npcs = world.getNpcsInRoom(room.id);
  if (npcs.length > 0) {
    lines.push(`You see here: ${npcs.map((n) => n.name).join(", ")}.`);
  }
  const hostiles = world.getHostilesInRoom(room.id);
  if (hostiles.length > 0) {
    lines.push(
      // "Monsters", not "Hostiles" — the CODE is genre-free (PRD-0002 R6),
      // the COPY is still this pack's. Renaming what a fantasy player reads
      // is a product change, and player-facing strings become pack-supplied
      // in phase 4 (R10). A world with nothing to fight never reaches this
      // line, so the word costs the care-centre deployment nothing.
      `Monsters here: ${hostiles
        .map((m) => `${m.name} (${m.currentHp}/${m.maxHp} HP)`)
        .join(", ")}.`,
    );
  }
  // Corpses, before the loose items. A pile with a name on it is the thing
  // a player is looking for after a fight, and burying it in the general
  // floor listing would make `loot` something you have to already know
  // about. Only PVP worlds ever have any.
  const corpses = world.getCorpsesInRoom(room.id);
  if (corpses.length > 0) {
    lines.push(
      `Fallen here: ${corpses
        .map((c) => `${c.ownerName}'s belongings`)
        .join(", ")}.`,
    );
  }
  // Items on the floor. Without this line `get` is unusable: a player has no
  // way to learn what is here to pick up, and guessing nouns is not a game
  // mechanic.
  const items = world.getItemsInRoom(room.id);
  if (items.length > 0) {
    lines.push(
      `Lying here: ${items
        .map((i) => (i.quantity > 1 ? `${i.name} (x${i.quantity})` : i.name))
        .join(", ")}.`,
    );
  }
  // Compass order, not alphabetical — see DIRECTIONS in the parser.
  const exits = sortDirections(Object.keys(room.exits));
  if (exits.length > 0) {
    lines.push(`Exits: ${exits.join(", ")}.`);
  } else {
    lines.push("There are no obvious exits.");
  }
  return lines;
}

export const lookHandler: CommandHandler = ({ world, session }) => {
  if (session.defeated && session.pendingRebirth) {
    // Recovered, but who they are is now an open question. The ws layer
    // collects the answers; `look` is just where a defeated player is told
    // there is one.
    session.defeated = false;
    session.currentHp = session.maxHp;
    return reply(
      "You wake somewhere quiet, remade but unshaped.",
      "Choose what you come back as — the first question is next.",
    );
  }
  if (session.defeated) {
    const spawn = world.getRoomByEnumKey(SPAWN_ROOM_ENUM_KEY);
    if (!spawn) {
      return reply(
        "You wake up in a featureless void. (Bug: spawn room missing.)",
      );
    }
    session.currentRoomId = spawn.id;
    session.currentHp = session.maxHp;
    session.defeated = false;
    return reply(
      "You wake — bruised, but breathing — back in the town square.",
      ...renderRoom(world, spawn),
    );
  }
  const room = world.getRoom(session.currentRoomId);
  if (!room) {
    return reply(
      "You're in a featureless void. (This is a bug — your character's current room is missing from the world.)",
    );
  }
  return reply(...renderRoom(world, room));
};
