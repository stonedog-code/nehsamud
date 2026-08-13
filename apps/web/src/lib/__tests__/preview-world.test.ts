import {
  DIRECTIONS,
  DIRECTION_ALIASES,
  PREVIEW_ROOMS,
  START_ROOM,
  applyCommand,
  initialState,
  type Direction,
  type PreviewCharacter,
  type PreviewState,
} from "../preview-world";
import { deriveStats, findClass, findRace } from "../catalog";

function run(state: PreviewState, input: string, mode = "pve" as const) {
  return applyCommand(state, input, mode);
}

/** A character built from the real catalog, not a hand-rolled stand-in. */
function character(
  name = "Aria",
  raceKey = "dwarf",
  classKey = "mage",
): PreviewCharacter {
  const race = findRace(raceKey);
  const characterClass = findClass(classKey);
  if (!race || !characterClass) {
    throw new Error(`test fixture: unknown ${raceKey}/${classKey}`);
  }
  return {
    name,
    race,
    characterClass,
    stats: deriveStats(race, characterClass),
  };
}

const start = () => initialState(character());

describe("world integrity", () => {
  it("starts in a room that exists", () => {
    expect(PREVIEW_ROOMS[START_ROOM]).toBeDefined();
  });

  it("has every exit pointing at a real room", () => {
    // Collect the dangling ones rather than asserting per-exit, so a failure
    // names every broken link at once instead of only the first.
    const dangling: string[] = [];
    for (const room of Object.values(PREVIEW_ROOMS)) {
      for (const [direction, target] of Object.entries(room.exits)) {
        if (!PREVIEW_ROOMS[target as string]) {
          dangling.push(`${room.key} --${direction}--> ${target}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("keys every room by its own key", () => {
    for (const [key, room] of Object.entries(PREVIEW_ROOMS)) {
      expect(room.key).toBe(key);
    }
  });

  it("reaches every room from the start", () => {
    // An unreachable room is content nobody will ever see.
    const seen = new Set<string>([START_ROOM]);
    const queue = [START_ROOM];
    while (queue.length > 0) {
      const room = PREVIEW_ROOMS[queue.shift()!];
      for (const target of Object.values(room.exits)) {
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    expect(seen.size).toBe(Object.keys(PREVIEW_ROOMS).length);
  });

  it("exercises the diagonals the direction set promises", () => {
    // PRD-0001 R12. The engine's parser only supports six directions today,
    // so the preview world is where the other four stay honest.
    const used = new Set<string>();
    for (const room of Object.values(PREVIEW_ROOMS)) {
      for (const direction of Object.keys(room.exits)) used.add(direction);
    }
    expect(used.has("southeast")).toBe(true);
    expect(used.has("northwest")).toBe(true);
    expect(used.has("up")).toBe(true);
    expect(used.has("down")).toBe(true);
  });
});

describe("direction aliases", () => {
  it("maps every short form onto a real direction", () => {
    for (const [alias, direction] of Object.entries(DIRECTION_ALIASES)) {
      expect(DIRECTIONS).toContain(direction);
      expect(alias.length).toBeLessThanOrEqual(2);
    }
  });

  it("covers all ten directions", () => {
    const covered = new Set(Object.values(DIRECTION_ALIASES));
    expect(covered.size).toBe(DIRECTIONS.length);
  });
});

describe("movement", () => {
  it("moves on a bare direction", () => {
    const next = run(start(), "north");
    expect(next.roomKey).toBe("sunroad");
  });

  it("moves on a short form", () => {
    expect(run(start(), "n").roomKey).toBe("sunroad");
  });

  it("moves on a diagonal short form", () => {
    // The case the engine currently cannot handle.
    expect(run(start(), "se").roomKey).toBe("market");
  });

  it("moves on 'go <direction>'", () => {
    expect(run(start(), "go north").roomKey).toBe("sunroad");
  });

  it("is case-insensitive", () => {
    expect(run(start(), "NORTH").roomKey).toBe("sunroad");
  });

  it("refuses a direction with no exit and stays put", () => {
    const next = run(start(), "down");
    expect(next.roomKey).toBe(START_ROOM);
    expect(next.lines.at(-1)?.text).toMatch(/can't go down/);
  });

  it("walks up and back down again", () => {
    let state = run(start(), "west");
    expect(state.roomKey).toBe("inn");
    state = run(state, "up");
    expect(state.roomKey).toBe("inn_upstairs");
    state = run(state, "down");
    expect(state.roomKey).toBe("inn");
  });

  it("names the new room on arrival", () => {
    const next = run(start(), "north");
    expect(next.lines.some((l) => l.kind === "room" && l.text === "Sunroad")).toBe(
      true,
    );
  });
});

describe("look and help", () => {
  it("describes the current room without moving", () => {
    const next = run(start(), "look");
    expect(next.roomKey).toBe(START_ROOM);
    expect(next.lines.at(-1)?.text).toMatch(/^Exits: /);
  });

  it("lists exits alphabetically", () => {
    const next = run(start(), "look");
    expect(next.lines.at(-1)?.text).toBe(
      "Exits: east, north, southeast, west.",
    );
  });

  it("answers help", () => {
    expect(run(start(), "help").lines.at(-1)?.text).toMatch(/Movement:/);
  });
});

describe("unknown input", () => {
  it("answers rather than staying silent", () => {
    const next = run(start(), "xyzzy");
    expect(next.lines.at(-1)?.text).toMatch(/don't know how to "xyzzy"/);
  });

  it("ignores empty input entirely", () => {
    const before = start();
    expect(run(before, "   ")).toBe(before);
  });

  it("echoes what the player typed", () => {
    const next = run(start(), "look");
    expect(next.lines.some((l) => l.kind === "echo" && l.text === "> look")).toBe(
      true,
    );
  });
});

describe("combat is gated on the mode, not the UI", () => {
  it("refuses combat in Exploration and says why in plain language", () => {
    // PRD-0001 R4 — the senior-safe build's core promise.
    const next = applyCommand(start(), "attack rat", "exploration");
    expect(next.lines.at(-1)?.text).toBe(
      "There is no fighting in this world. Nothing here will harm you.",
    );
  });

  it("refuses 'kill' the same way", () => {
    const next = applyCommand(start(), "kill rat", "exploration");
    expect(next.lines.at(-1)?.text).toMatch(/no fighting/);
  });

  it("does not give that refusal in PVE or PVP", () => {
    for (const mode of ["pve", "pvp"] as const) {
      const next = applyCommand(start(), "attack rat", mode);
      expect(next.lines.at(-1)?.text).not.toMatch(/no fighting/);
    }
  });
});

describe("initial state", () => {
  it("greets the player by name, race and class", () => {
    // The race and class appear in the very first line the player reads.
    // Until the choice was carried this far it was collected, previewed and
    // then never mentioned again — indistinguishable from being discarded.
    expect(initialState(character("Bran")).lines[0].text).toMatch(
      /Welcome, Bran the Dwarf Mage\./,
    );
  });

  it("describes the starting room immediately", () => {
    expect(
      initialState(character("Bran")).lines.some(
        (l) => l.kind === "room" && l.text === "Town Square",
      ),
    ).toBe(true);
  });
});

describe("stats", () => {
  it("reports the chosen race and class", () => {
    const text = run(start(), "stats")
      .lines.map((l) => l.text)
      .join("\n");
    expect(text).toContain("Dwarf Mage");
    expect(text).toContain("Aria — level 1");
  });

  it("reports the stats those choices derive", () => {
    const dwarfMage = deriveStats(findRace("dwarf")!, findClass("mage")!);
    const text = run(start(), "stats")
      .lines.map((l) => l.text)
      .join("\n");
    expect(text).toContain(`Health: ${dwarfMage.hp} of ${dwarfMage.hp}`);
    expect(text).toContain(`Damage: ${dwarfMage.damage} per swing`);
  });

  it("differs between two different characters", () => {
    // The assertion the whole change exists for: two selections must not
    // produce the same sheet.
    const a = run(initialState(character("A", "dwarf", "warrior")), "stats")
      .lines.map((l) => l.text)
      .join("\n");
    const b = run(initialState(character("B", "halfling", "mage")), "stats")
      .lines.map((l) => l.text)
      .join("\n");
    expect(a).not.toBe(b);
    expect(a).toContain("Dwarf Warrior");
    expect(b).toContain("Halfling Mage");
  });

  it("survives a move, because the character is not room state", () => {
    const moved = run(start(), "north");
    expect(
      run(moved, "stats")
        .lines.map((l) => l.text)
        .join("\n"),
    ).toContain("Dwarf Mage");
  });

  it("is listed in help", () => {
    expect(
      run(start(), "help")
        .lines.map((l) => l.text)
        .join("\n"),
    ).toContain("stats");
  });
});

describe("state is replaced, not mutated", () => {
  it("leaves the previous state untouched", () => {
    const before = start();
    const lineCount = before.lines.length;
    const after = run(before, "north");
    expect(before.roomKey).toBe(START_ROOM);
    expect(before.lines).toHaveLength(lineCount);
    expect(after).not.toBe(before);
  });
});

describe("exit typing", () => {
  it("only uses directions from the declared set", () => {
    const valid = new Set<Direction>(DIRECTIONS);
    for (const room of Object.values(PREVIEW_ROOMS)) {
      for (const direction of Object.keys(room.exits)) {
        expect(valid.has(direction as Direction)).toBe(true);
      }
    }
  });
});
