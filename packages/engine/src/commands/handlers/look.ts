/**
 * `look` — render the current room.
 *
 * Output shape:
 *   <Room name>
 *   <Room description>
 *   You see here: <npc names>      (only when at least one NPC)
 *   Monsters here: <monster names + HP> (only when at least one)
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
import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

const SPAWN_ROOM_ENUM_KEY = "TOWNSMEE_TOWNSQUARE";

function renderRoom(world: WorldState, room: CachedRoom): string[] {
  const lines = [room.name, room.description];
  const npcs = world.getNpcsInRoom(room.id);
  if (npcs.length > 0) {
    lines.push(`You see here: ${npcs.map((n) => n.name).join(", ")}.`);
  }
  const monsters = world.getMonstersInRoom(room.id);
  if (monsters.length > 0) {
    lines.push(
      `Monsters here: ${monsters
        .map((m) => `${m.name} (${m.currentHp}/${m.maxHp} HP)`)
        .join(", ")}.`,
    );
  }
  const exits = Object.keys(room.exits).sort();
  if (exits.length > 0) {
    lines.push(`Exits: ${exits.join(", ")}.`);
  } else {
    lines.push("There are no obvious exits.");
  }
  return lines;
}

export const lookHandler: CommandHandler = ({ world, session }) => {
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
