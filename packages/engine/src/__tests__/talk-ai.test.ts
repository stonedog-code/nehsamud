import { STARTING_LIVES } from "../progression.js";
/**
 * NPC ai-mode dialog routing through the text generator.
 *
 * Strategy: build a hydrated WorldState with one canned NPC + one
 * ai-mode NPC, inject a fake TextGenerator into the context, and
 * verify the routing — including the silent canned fallback when
 * the generator throws.
 */

import type { AiServices } from "../ai/factory.js";
import type { TextGenerator } from "../ai/text-generator.js";
import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import type { SessionState } from "../world/session.js";
import type { CachedNpc, CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";

function fakeText(response: string | Error): TextGenerator {
  return {
    generate: jest.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  };
}

function buildWorld(): WorldState {
  const inn: CachedRoom = {
    id: "room-inn",
    enumKey: "TOWNSMEE_INN",
    name: "Inn",
    description: "Warm fire.",
    exits: {},
    environment: "townsmee",
    area: "townsmee",
    imageName: null,
  };
  const cannedNpc: CachedNpc = {
    id: "npc-canned",
    slug: "zofia",
    name: "Zofia",
    description: "Innkeeper.",
    roomId: "room-inn",
    pronoun: "she",
    tags: ["good"],
    intelligenceMode: "canned",
    dialogLines: ["A room for the night?"],
    interests: ["lodging"],
  };
  const aiNpc: CachedNpc = {
    id: "npc-ai",
    slug: "oracle",
    name: "Oracle",
    description: "Wise hermit.",
    roomId: "room-inn",
    pronoun: "they",
    tags: ["neutral"],
    intelligenceMode: "ai",
    dialogLines: ["Hmm.", "Maybe."],
    interests: ["fate", "weather"],
  };
  const w = new WorldState();
  w.hydrate([inn], [cannedNpc, aiNpc]);
  return w;
}

function sessionAt(roomId: string): SessionState {
  return {
    userId: "u-1",
    currentRoomId: roomId,
    currentHp: 30,
    maxHp: 30,
    experience: 0,
    level: 1,
    lives: STARTING_LIVES,
    rebirths: 0,
    inventory: [],
    defeated: false,
    resting: false,
  };
}

describe("talk handler — ai routing", () => {
  it("routes to the LLM when NPC mode is ai AND ctx.ai.text is present", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const text = fakeText("The wind shifts to the north tonight.");
    const ai: AiServices = { text };
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk oracle"),
      ai,
    });
    expect(text.generate).toHaveBeenCalledTimes(1);
    expect(result.response.lines[0]).toContain(
      "The wind shifts to the north tonight.",
    );
  });

  it("falls back to canned silently when the LLM throws", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const text = fakeText(new Error("provider 503"));
    const ai: AiServices = { text };
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk oracle"),
      ai,
    });
    expect(text.generate).toHaveBeenCalledTimes(1);
    const reply = result.response.lines[0] ?? "";
    expect(reply).toMatch(/Oracle says: "(Hmm\.|Maybe\.)"/);
  });

  it("stays canned when the NPC's intelligenceMode is canned", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const text = fakeText("never called");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk zofia"),
      ai: { text },
    });
    expect(text.generate).not.toHaveBeenCalled();
    expect(result.response.lines[0]).toContain("Zofia says:");
  });

  it("stays canned when ai.text is undefined even for ai-mode NPCs", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk oracle"),
      ai: undefined,
    });
    const reply = result.response.lines[0] ?? "";
    expect(reply).toMatch(/Oracle says: "(Hmm\.|Maybe\.)"/);
  });

  it("the AI prompt includes the NPC name, interests, and room description", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const text = fakeText("placeholder");
    await dispatch({
      world,
      session,
      command: parseCommand("talk oracle"),
      ai: { text },
    });
    const call = (text.generate as jest.Mock).mock.calls[0];
    const prompt = call?.[0] as string;
    expect(prompt).toContain("Oracle");
    expect(prompt).toContain("fate");
    expect(prompt).toContain("Warm fire");
  });
});
