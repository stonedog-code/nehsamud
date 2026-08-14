/**
 * `talk <npc>` — initiate dialog with a named NPC.
 *
 * Routing (Phase 6):
 *   - NPC.intelligenceMode === "ai" AND ctx.ai.text is present →
 *     ask the LLM with a prompt that blends NPC personality
 *     (name, alignment, interests) with the current room. Falls
 *     back to canned silently on any error so a degraded provider
 *     doesn't freeze the player out of dialog.
 *   - Otherwise: canned-cycle picks a line from the NPC's
 *     `dialogLines` based on a 10-s time bucket + per-NPC slug
 *     hash so two players don't always see the same line.
 *
 * Match order:
 *   1. Slug exact match in the current room ("talk zofia").
 *   2. Display name first word in the current room ("talk mira").
 *   3. Global fallback for system NPCs not currently placed.
 */

import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const talkHandler: CommandHandler = async ({
  world,
  session,
  command,
  ai,
}) => {
  const target = command.args[0];
  if (!target) {
    return reply("Talk to whom?");
  }

  const inRoomMatch = world.findNpcByName(target, session.currentRoomId);
  const npc = inRoomMatch ?? world.findNpcByName(target);

  if (!npc) {
    return reply(`There's no one named "${target}" here.`);
  }
  if (npc.roomId !== session.currentRoomId) {
    return reply(
      `${npc.name} isn't here. (Last seen ${npc.roomId ? "elsewhere" : "in transit"}.)`,
    );
  }

  const room = world.getRoom(session.currentRoomId);
  const roomDescription = room?.description ?? "";

  if (npc.intelligenceMode === "ai" && ai?.text) {
    try {
      const prompt = buildAiPrompt({
        npcName: npc.name,
        npcTags: npc.tags,
        npcPronoun: npc.pronoun,
        npcInterests: npc.interests,
        npcCannedLines: npc.dialogLines,
        roomDescription,
      });
      const generated = await ai.text.generate(prompt);
      return reply(`${npc.name} says: "${generated}"`);
    } catch {
      // Silent fallback to canned. Players don't need to know the
      // LLM stuttered; a canned line is a clean degradation.
      const line = pickCannedLine(npc);
      if (line === undefined) {
        return reply(`${npc.name} nods but says nothing.`);
      }
      return reply(`${npc.name} says: "${line}"`);
    }
  }

  const line = pickCannedLine(npc);
  if (line === undefined) {
    return reply(`${npc.name} nods but says nothing.`);
  }
  return reply(`${npc.name} says: "${line}"`);
};

interface AiPromptInput {
  npcName: string;
  npcTags: string[];
  npcPronoun: string;
  npcInterests: string[];
  npcCannedLines: string[];
  roomDescription: string;
}

function buildAiPrompt(input: AiPromptInput): string {
  // Short prompt on purpose: longer contexts make the LLM
  // ramble, which reads as "out of character" to players. The
  // canned lines act as style anchors.
  return [
    "You are a non-player character in a fantasy MUD.",
    `Character name: ${input.npcName}.`,
    `Pronoun: ${input.npcPronoun}.`,
    // Was `Alignment: evil.` — one word from a four-value fantasy morality
    // scale. Tags say more and assume less: a pack labels its own people
    // however it needs to, and the model reads the labels as flavour.
    `How others describe you: ${
      input.npcTags.join(", ") || "unremarkable"
    }.`,
    `Topics you care about: ${
      input.npcInterests.join(", ") || "none in particular"
    }.`,
    `Your typical lines: ${input.npcCannedLines.join(" | ")}.`,
    `Current setting: ${input.roomDescription}`,
    "",
    "A traveler approaches and says 'Hello'. Respond in character",
    "with ONE short line of dialog (≤ 30 words). Do not narrate",
    "actions. Just the spoken line.",
  ].join("\n");
}

function pickCannedLine(npc: {
  slug: string;
  dialogLines: string[];
}): string | undefined {
  if (npc.dialogLines.length === 0) return undefined;
  const slugHash = npc.slug
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
  const tick = Math.floor(Date.now() / 1000 / 10);
  const offset = Math.abs((slugHash + tick) % npc.dialogLines.length);
  return npc.dialogLines[offset];
}
