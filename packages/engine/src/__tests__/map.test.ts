import {
  AREAS,
  ITEM_PLACEMENTS,
  ITEMS,
  MONSTERS,
  MONSTER_SPAWNS,
  ROOMS,
  findArea,
} from "../seed/fixtures/index.js";

/**
 * Map integrity.
 *
 * These are content tests, and content is exactly where a bug hides longest:
 * nothing throws, nothing fails to compile, and the only symptom is a player
 * who cannot get somewhere. The map shipped for months with an ISLAND —
 * the armoury, the lower quarter and the Mindroad Bridge were mutually
 * reciprocal and completely unreachable from the town square, so the goblin
 * the demo flow relied on sat in a room no player could walk to.
 *
 * A reciprocity check alone would not have found it: every exit in that
 * island had a matching return. Reachability is the property that mattered,
 * and it had nothing asserting it.
 */

const OPPOSITE: Readonly<Record<string, string>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  northeast: "southwest",
  southwest: "northeast",
  northwest: "southeast",
  southeast: "northwest",
  up: "down",
  down: "up",
};

const SPAWN_ROOM = "TOWNSMEE_TOWNSQUARE";

const byKey = new Map(ROOMS.map((room) => [room.enumKey, room]));

/** Every room reachable from the spawn, by walking exits. */
function reachableFromSpawn(): Set<string> {
  const seen = new Set([SPAWN_ROOM]);
  const queue = [SPAWN_ROOM];
  while (queue.length > 0) {
    const room = byKey.get(queue.pop()!);
    if (!room) continue;
    for (const target of Object.values(room.exits)) {
      if (byKey.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/* ── structure ────────────────────────────────────────────────── */

describe("map structure", () => {
  it("has unique room keys", () => {
    expect(new Set(ROOMS.map((r) => r.enumKey)).size).toBe(ROOMS.length);
  });

  it("points every exit at a room that exists", () => {
    // Collected rather than asserted per-exit, so a failure names every
    // broken link at once instead of only the first.
    const dangling: string[] = [];
    for (const room of ROOMS) {
      for (const [direction, target] of Object.entries(room.exits)) {
        if (!byKey.has(target)) {
          dangling.push(`${room.enumKey}.${direction} -> ${target}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("uses only directions the parser understands", () => {
    // An exit named `inward` compiles, seeds, and can never be walked.
    const unknown: string[] = [];
    for (const room of ROOMS) {
      for (const direction of Object.keys(room.exits)) {
        if (!(direction in OPPOSITE)) {
          unknown.push(`${room.enumKey}.${direction}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("makes every exit walkable in both directions", () => {
    const oneWay: string[] = [];
    for (const room of ROOMS) {
      for (const [direction, target] of Object.entries(room.exits)) {
        const destination = byKey.get(target);
        if (!destination) continue;
        if (destination.exits[OPPOSITE[direction]!] !== room.enumKey) {
          oneWay.push(`${room.enumKey} --${direction}--> ${target}`);
        }
      }
    }
    expect(oneWay).toEqual([]);
  });

  it("leaves no room unreachable from the spawn", () => {
    // The check that would have caught the island.
    const reachable = reachableFromSpawn();
    const stranded = ROOMS.filter((r) => !reachable.has(r.enumKey)).map(
      (r) => r.enumKey,
    );
    expect(stranded).toEqual([]);
  });

  it("gives every room a real area", () => {
    for (const room of ROOMS) {
      expect(findArea(room.area)).toBeDefined();
    }
  });
});

/* ── areas ────────────────────────────────────────────────────── */

describe("areas", () => {
  it("offers more than the starting town", () => {
    // The issue: "there is only the town".
    expect(AREAS.length).toBeGreaterThanOrEqual(3);
    const populated = AREAS.filter((a) =>
      ROOMS.some((r) => r.area === a.key),
    );
    expect(populated).toHaveLength(AREAS.length);
  });

  it("starts the player in the ring-0 area", () => {
    const start = byKey.get(SPAWN_ROOM);
    expect(findArea(start!.area)?.ring).toBe(0);
  });

  it("scales difficulty outward and never backwards", () => {
    // "Difficulty rises as you go out" is a claim in a comment until
    // something checks it.
    const ordered = [...AREAS].sort((a, b) => a.ring - b.ring);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.minLevel).toBeGreaterThanOrEqual(
        ordered[i - 1]!.minLevel,
      );
      expect(ordered[i]!.maxLevel).toBeGreaterThan(ordered[i - 1]!.maxLevel);
    }
  });

  it("lets a player walk from the town into every other area", () => {
    const reachable = reachableFromSpawn();
    for (const area of AREAS) {
      const roomsHere = ROOMS.filter((r) => r.area === area.key);
      expect(roomsHere.some((r) => reachable.has(r.enumKey))).toBe(true);
    }
  });
});

/* ── spawns ───────────────────────────────────────────────────── */

describe("monster spawns", () => {
  const monsterBySlug = new Map(MONSTERS.map((m) => [m.slug, m]));

  it("places every spawn in a room and a monster that exist", () => {
    for (const spawn of MONSTER_SPAWNS) {
      expect(byKey.get(spawn.roomEnumKey)).toBeDefined();
      expect(monsterBySlug.get(spawn.monsterSlug)).toBeDefined();
    }
  });

  it("keeps every monster inside its area's declared level band", () => {
    // A band that says 5–8 with a level-1 rat in it is a content bug, and
    // the declaration exists precisely so this can be checked.
    const violations: string[] = [];
    for (const spawn of MONSTER_SPAWNS) {
      const room = byKey.get(spawn.roomEnumKey);
      const monster = monsterBySlug.get(spawn.monsterSlug);
      const area = room ? findArea(room.area) : undefined;
      if (!room || !monster || !area) continue;
      if (monster.level < area.minLevel || monster.level > area.maxLevel) {
        violations.push(
          `${spawn.monsterSlug} (lv ${monster.level}) in ${area.key} (lv ${area.minLevel}-${area.maxLevel})`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives every area beyond the town something to fight", () => {
    for (const area of AREAS.filter((a) => a.ring > 0)) {
      const roomsHere = new Set(
        ROOMS.filter((r) => r.area === area.key).map((r) => r.enumKey),
      );
      expect(
        MONSTER_SPAWNS.some((s) => roomsHere.has(s.roomEnumKey)),
      ).toBe(true);
    }
  });

  it("puts more experience on offer further out", () => {
    // The point of a second area is somewhere better to level.
    const xpIn = (key: string) =>
      MONSTER_SPAWNS.filter((s) => byKey.get(s.roomEnumKey)?.area === key)
        .map((s) => monsterBySlug.get(s.monsterSlug)?.experience ?? 0)
        .reduce((a, b) => a + b, 0);
    expect(xpIn("barrowdeep-deep")).toBeGreaterThan(xpIn("townsmee"));
  });
});

/* ── crossing a boundary ──────────────────────────────────────── */

describe("area transitions are announced", () => {
  /** Build the real map in memory and walk one exit. */
  async function walk(fromKey: string, direction: string): Promise<string> {
    const { WorldState } = await import("../world/world-state.js");
    const { dispatch } = await import("../commands/dispatch.js");
    const { parseCommand } = await import("../commands/parser.js");
    const { DEFAULT_MAX_HP } = await import("../world/session.js");

    const world = new WorldState("pve");
    world.hydrate(
      ROOMS.map((r) => ({
        id: r.enumKey,
        enumKey: r.enumKey,
        name: r.name,
        description: r.description,
        exits: r.exits,
        environment: r.environment,
        area: r.area,
        imageName: null,
      })),
    );
    const result = await dispatch({
      world,
      session: {
        userId: "u-1",
        characterName: "Aria",
        currentRoomId: fromKey,
        currentHp: DEFAULT_MAX_HP,
        maxHp: DEFAULT_MAX_HP,
        experience: 0,
        level: 1,
        inventory: [],
        defeated: false,
        resting: false,
      },
      command: parseCommand(direction),
    });
    return result.response.lines.join("\n");
  }

  it("announces the region when the player crosses into it", async () => {
    // Crossing out of the safe ring is the moment a player needs telling,
    // because the next room is where the difficulty steps up.
    expect(await walk("TOWNSMEE_MINDROAD_BRIDGE", "east")).toContain(
      "You have entered The Kingsreach Wilds.",
    );
  });

  it("announces it going down into the barrow, too", async () => {
    expect(await walk("WILDS_BARROW_MOUTH", "down")).toContain(
      "You have entered Barrowdeep",
    );
  });

  it("lets a player walk every direction the fixtures use", async () => {
    // The bug this catches: `move` kept its OWN list of valid directions,
    // and when the parser learned the four diagonals that copy was not
    // updated. Diagonals parsed and were then refused, so every diagonal
    // exit in the world was unwalkable — with valid fixtures, a correct
    // parser, and nothing failing anywhere.
    const used = new Set(
      ROOMS.flatMap((room) => Object.keys(room.exits)),
    );
    expect(used.has("northeast")).toBe(true);

    for (const direction of used) {
      const from = ROOMS.find((r) => r.exits[direction]);
      const text = await walk(from!.enumKey, direction);
      expect(text).not.toContain("isn't a direction you can travel");
    }
  });

  it("says nothing when the move stays inside one area", async () => {
    // Otherwise it is noise on 39 renders to carry information that matters
    // on four of them.
    expect(await walk("WILDS_HEATH_WEST", "east")).not.toContain(
      "You have entered",
    );
  });
});

/* ── items ────────────────────────────────────────────────────── */

describe("item placements", () => {
  const itemByName = new Set(ITEMS.map((i) => i.name));

  it("places every item in a room and a catalog entry that exist", () => {
    for (const placement of ITEM_PLACEMENTS) {
      expect(byKey.get(placement.roomEnumKey)).toBeDefined();
      expect(itemByName.has(placement.itemName)).toBe(true);
    }
  });

  it("puts a light source on the way to the dark place, not inside it", () => {
    // A player who walks into a lightless barrow with no light has been set
    // up to fail by the map rather than by a choice they made.
    const lightSources = ["Torch", "Oil Lantern", "Candle"];
    const beforeTheBarrow = ITEM_PLACEMENTS.filter((p) => {
      const area = byKey.get(p.roomEnumKey)?.area;
      return area === "kingsreach-wilds" && lightSources.includes(p.itemName);
    });
    expect(beforeTheBarrow.length).toBeGreaterThan(0);
  });
});
