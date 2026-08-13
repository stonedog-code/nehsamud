/**
 * Communication verbs — `say`, `yell`, `whisper`, `who`.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud),
 * core/commands/{say,yell,whisper,who}.py. Until these landed, a *multi*-user
 * dungeon had no way for two players to talk to each other — every verb only
 * answered the person who typed it.
 *
 * THREE BUGS IN THE ORIGINALS ARE DELIBERATELY NOT PORTED:
 *
 *   - `whisper` and `telepath` computed the message as
 *     `command.split(" ", 1)[1]`, which still contains the target's name — so
 *     "whisper bob hello" delivered "bob hello". Split twice here.
 *   - `who` shadowed its `player` parameter with the loop variable and then
 *     sent the result to `player.websocket`, i.e. to whichever player happened
 *     to be last in the registry rather than to the caller.
 *
 * `telepath` is not ported: it is gated on `can_telepath()`, a class ability,
 * and class abilities are being reshaped by PRD-0002. Porting it now would
 * mean writing the gate twice.
 */

import type { Broadcast, CommandHandler } from "../types.js";
import { reply, replyWith } from "../types.js";

/** What to call a player in something another player reads. */
function speakerName(name: string | undefined): string {
  return name ?? "Someone";
}

export const sayHandler: CommandHandler = ({ session, command }) => {
  const message = command.rest.trim();
  if (!message) {
    return reply("Say what?");
  }
  return replyWith(
    [
      {
        scope: "room",
        roomId: session.currentRoomId,
        message: `${speakerName(session.characterName)} says "${message}"`,
      },
    ],
    `You say "${message}"`,
  );
};

export const yellHandler: CommandHandler = ({ session, command }) => {
  const message = command.rest.trim();
  if (!message) {
    return reply("Yell what?");
  }
  return replyWith(
    [
      {
        scope: "room",
        roomId: session.currentRoomId,
        message: `${speakerName(session.characterName)} yells "${message}"`,
      },
      {
        // Adjacent rooms hear that something happened, not what was said.
        // That is the point of yell being distinct from say: it carries
        // presence further than content.
        scope: "adjacent",
        roomId: session.currentRoomId,
        message: "You hear a loud yell from an adjacent room.",
      },
    ],
    `You yell "${message}"`,
  );
};

export const whisperHandler: CommandHandler = ({
  session,
  sessions,
  command,
}) => {
  const [targetName, ...rest] = command.args;
  const message = rest.join(" ").trim();

  if (!targetName) {
    return reply("Whisper to whom?");
  }
  if (!message) {
    return reply(`Whisper what to ${targetName}?`);
  }

  const target = sessions?.findByCharacterName(targetName);
  if (!target || target.currentRoomId !== session.currentRoomId) {
    // Same answer whether they are elsewhere or not playing at all. Telling a
    // player that someone exists but is in another room is a way to locate
    // people you cannot see, which `who` should decide to expose, not
    // `whisper` by accident.
    return reply(`There's no "${targetName}" here to whisper to.`);
  }
  if (target.userId === session.userId) {
    return reply("You mutter to yourself.");
  }

  const broadcasts: Broadcast[] = [
    {
      scope: "user",
      userId: target.userId,
      message: `${speakerName(session.characterName)} whispers "${message}" to you.`,
    },
  ];
  return replyWith(
    broadcasts,
    `You whisper "${message}" to ${speakerName(target.characterName)}.`,
  );
};

export const whoHandler: CommandHandler = ({ session, sessions }) => {
  const all = sessions?.all() ?? [session];
  const names = all
    .map((s) => speakerName(s.characterName))
    .sort((a, b) => a.localeCompare(b));

  const lines = [
    names.length === 1 ? "1 player online:" : `${names.length} players online:`,
  ];
  for (const name of names) lines.push(`  ${name}`);
  return reply(...lines);
};
