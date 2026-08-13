/**
 * Per-handler unit tests against a hydrated WorldState. No DB,
 * no sockets — the dispatcher and individual handlers are pure
 * functions on the (world, session, command) triple.
 */

import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import type { CachedNpc, CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";

function buildWorld(): WorldState {
  const square: CachedRoom = {
    id: "room-square",
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description: "A cobbled square with a wolf-shaped fountain.",
    exits: { north: "room-inn" },
    environment: "townsmee",
    imageName: null,
  };
  const inn: CachedRoom = {
    id: "room-inn",
    enumKey: "TOWNSMEE_INN",
    name: "The Quiet Bed",
    description: "Warm fireplace, worn rugs.",
    exits: { south: "room-square" },
    environment: "townsmee",
    imageName: null,
  };
  const zofia: CachedNpc = {
    id: "npc-zofia",
    slug: "zofia",
    name: "Zofia",
    description: "Innkeeper.",
    roomId: "room-inn",
    pronoun: "she",
    alignment: "good",
    intelligenceMode: "canned",
    dialogLines: ["A room for the night?", "Mind the goblins south."],
    interests: ["lodging"],
  };
  // PVE so the `look` monster-line cases have monsters to render.
  const w = new WorldState("pve");
  w.hydrate([square, inn], [zofia]);
  return w;
}

function sessionAt(roomId: string) {
  return {
    userId: "u-1",
    currentRoomId: roomId,
    currentHp: 30,
    maxHp: 30,
    experience: 0,
    level: 1,
    defeated: false,
  };
}

describe("look handler", () => {
  it("renders the current room", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("look"),
    });
    expect(result.response.lines[0]).toBe("Town Square");
    expect(result.response.lines[1]).toContain("cobbled square");
    expect(result.response.lines.at(-1)).toContain("Exits: north");
  });

  it("includes NPCs in the room render", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand("l"),
    })).response.lines;
    expect(lines.some((l) => l.includes("Zofia"))).toBe(true);
  });

  it("falls back to a friendly error when the room is missing", async () => {
    const world = buildWorld();
    const session = sessionAt("room-void");
    const lines = (
      await dispatch({ world, session, command: parseCommand("look") })
    ).response.lines;
    expect(lines.join(" ")).toContain("featureless void");
  });
});

describe("move handler", () => {
  it("changes session.currentRoomId on a valid exit + auto-looks", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("north"),
    });
    expect(session.currentRoomId).toBe("room-inn");
    expect(result.response.lines[0]).toBe("The Quiet Bed");
  });

  it("refuses an unknown direction", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const before = session.currentRoomId;
    const result = await dispatch({
      world,
      session,
      command: parseCommand("move sideways"),
    });
    expect(session.currentRoomId).toBe(before);
    expect(result.response.lines.join(" ")).toMatch(/isn't a direction|can't go/);
  });

  it("refuses a direction with no exit", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("south"),
    });
    expect(session.currentRoomId).toBe("room-square");
    expect(result.response.lines.join(" ")).toContain("can't go south");
  });
});

describe("talk handler", () => {
  it("matches NPCs by slug, case-insensitive", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk ZOFIA"),
    });
    expect(result.response.lines[0]).toMatch(/Zofia says: /);
  });

  it("matches NPCs by their display-name first word", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk zofia"),
    });
    expect(result.response.lines[0]).toContain("Zofia");
  });

  it("rejects talking to absent NPCs from the wrong room", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("talk zofia"),
    });
    expect(result.response.lines.join(" ")).toMatch(/isn't here|no one named/);
  });

  it("asks for a target when no arg is given", async () => {
    const world = buildWorld();
    const session = sessionAt("room-inn");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand("talk"),
    })).response.lines;
    expect(lines.join(" ")).toMatch(/Talk to whom/);
  });
});

describe("dispatch — unknown verb + empty input", () => {
  it("empty input prompts for input", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand(""),
    })).response.lines;
    expect(lines.join(" ")).toMatch(/help/);
  });

  it("unknown verb suggests help", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand("frobnicate"),
    })).response.lines;
    expect(lines.join(" ")).toMatch(/Unknown command "frobnicate"/);
  });

  it("help lists the canonical verbs", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand("help"),
    })).response.lines;
    const joined = lines.join("\n");
    for (const verb of ["look", "talk", "inventory", "help", "quit"]) {
      expect(joined).toContain(verb);
    }
  });

  it("quit sets closeSocket on the dispatch result", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const result = await dispatch({
      world,
      session,
      command: parseCommand("quit"),
    });
    expect(result.closeSocket).toBe(true);
    expect(result.response.lines.join(" ")).toMatch(/Safe travels/);
  });

  it("inventory returns the empty-placeholder response", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const lines = (await dispatch({
      world,
      session,
      command: parseCommand("inventory"),
    })).response.lines;
    expect(lines.join(" ")).toContain("empty");
  });
});
