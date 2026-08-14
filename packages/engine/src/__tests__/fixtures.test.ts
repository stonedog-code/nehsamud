/**
 * Per-category fixture integrity checks. Catches the boring but
 * easy-to-miss bugs that Phase 4+ relies on staying clean:
 *
 *   - Slugs / enumKeys / item names are unique within each
 *     catalog (Prisma would reject the seed, but we want a faster
 *     signal).
 *   - Room exits only reference enumKeys that exist in the room
 *     catalog (a typo here breaks navigation at runtime, after
 *     the seed has happily upserted both ends).
 *   - NPC roomEnumKey references resolve to a real room.
 *   - Tags are non-empty, lowercase and free of duplicates. There is no
 *     permitted VOCABULARY any more — tags are pack-defined, and an engine
 *     test asserting which ones exist would put back the fixed taxonomy
 *     that `alignment` and `mobType` were. What is still checkable is that
 *     they are well-formed.
 */

import { parseCommand } from "../commands/parser.js";
import {
  CHARACTER_OPTION_GROUPS,
  EFFECTS,
  ITEMS,
  HOSTILES,
  NPCS,
  ROOMS,
} from "../seed/fixtures/index.js";

const PRONOUNS = new Set(["he", "she", "they"]);

/** A tag is a lowercase label; the engine attaches no meaning to which. */
function malformedTags(tags: string[]): boolean {
  return (
    tags.length === 0 ||
    new Set(tags).size !== tags.length ||
    tags.some((t) => t.trim() === "" || t !== t.toLowerCase())
  );
}

function uniqueKeys<T>(items: T[], key: (t: T) => string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

describe("fixture integrity — unique keys", () => {
  it("character option group keys are unique", () => {
    expect(uniqueKeys(CHARACTER_OPTION_GROUPS, (g) => g.key)).toBe(true);
  });
  it("option slugs are unique within each group", () => {
    // Within, not across: two groups may both offer a "standard", and the
    // database keys them by (group, slug) for exactly that reason.
    for (const group of CHARACTER_OPTION_GROUPS) {
      expect(uniqueKeys(group.options, (o) => o.slug)).toBe(true);
    }
  });
  it("every group offers at least one selectable option", () => {
    // A required group with nothing to pick would leave the creation flow
    // asking a question with no valid answer.
    for (const group of CHARACTER_OPTION_GROUPS) {
      expect(
        group.options.filter((o) => o.selectable !== false).length,
      ).toBeGreaterThan(0);
    }
  });
  it("room enumKeys are unique", () => {
    expect(uniqueKeys(ROOMS, (r) => r.enumKey)).toBe(true);
  });
  it("item names are unique", () => {
    expect(uniqueKeys(ITEMS, (i) => i.name)).toBe(true);
  });
  it("hostile slugs are unique", () => {
    expect(uniqueKeys(HOSTILES, (m) => m.slug)).toBe(true);
  });
  it("NPC slugs are unique", () => {
    expect(uniqueKeys(NPCS, (n) => n.slug)).toBe(true);
  });
  it("effect slugs are unique", () => {
    expect(uniqueKeys(EFFECTS, (e) => e.slug)).toBe(true);
  });
});

describe("fixture integrity — referential", () => {
  const roomKeys = new Set(ROOMS.map((r) => r.enumKey));

  it("every room exit targets an existing room", () => {
    const errors: string[] = [];
    for (const room of ROOMS) {
      for (const [direction, target] of Object.entries(room.exits)) {
        if (!roomKeys.has(target)) {
          errors.push(`${room.enumKey}.exits.${direction} → ${target} not found`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("every NPC roomEnumKey resolves to an existing room", () => {
    const errors: string[] = [];
    for (const npc of NPCS) {
      if (npc.roomEnumKey === null) continue;
      if (!roomKeys.has(npc.roomEnumKey)) {
        errors.push(`${npc.slug}.roomEnumKey=${npc.roomEnumKey} not found`);
      }
    }
    expect(errors).toEqual([]);
  });
});

describe("fixture integrity — map topology", () => {
  // Ported from the Python `test_rooms.py::test_bidirectional_exits`
  // — every exit MUST have a reverse exit so a player can always
  // walk back the way they came. A one-way exit would soft-lock
  // the player out of the rest of the map.
  const REVERSE: Record<string, string> = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
    northeast: "southwest",
    northwest: "southeast",
    southeast: "northwest",
    southwest: "northeast",
    up: "down",
    down: "up",
  };

  it("every exit has a corresponding reverse exit", () => {
    const roomsByKey = new Map(ROOMS.map((r) => [r.enumKey, r]));
    const errors: string[] = [];
    for (const room of ROOMS) {
      for (const [direction, targetKey] of Object.entries(room.exits)) {
        const reverseDir = REVERSE[direction];
        if (!reverseDir) {
          errors.push(`${room.enumKey}.exits.${direction}: unknown direction (no reverse defined)`);
          continue;
        }
        const target = roomsByKey.get(targetKey);
        if (!target) continue; // referenced-room test catches this.
        const reverseTarget = target.exits[reverseDir];
        if (reverseTarget !== room.enumKey) {
          errors.push(
            `${room.enumKey} -[${direction}]-> ${targetKey}, but ${targetKey}.${reverseDir} = ${reverseTarget ?? "<missing>"}`,
          );
        }
      }
    }
    expect(errors).toEqual([]);
  });
});

describe("fixture integrity — enum vocab", () => {
  it("hostile tags are well-formed", () => {
    const errors = HOSTILES.filter((m) => malformedTags(m.tags));
    expect(errors).toEqual([]);
  });
  it("NPC tags are well-formed", () => {
    const errors = NPCS.filter((n) => malformedTags(n.tags));
    expect(errors).toEqual([]);
  });
  it("NPC pronouns are in the known vocab", () => {
    const errors = NPCS.filter((n) => !PRONOUNS.has(n.pronoun));
    expect(errors).toEqual([]);
  });
});

describe("fixture integrity — minimum content", () => {
  it("has at least the focused-rewrite floor counts", () => {
    // Floors come from the Phase 3 plan — if a future PR drops
    // below them, that's a regression that should require an
    // explicit test-update.
    for (const group of CHARACTER_OPTION_GROUPS) {
      expect(group.options.length).toBeGreaterThanOrEqual(4);
    }
    expect(ROOMS.length).toBeGreaterThanOrEqual(15);
    expect(ITEMS.length).toBeGreaterThanOrEqual(15);
    expect(HOSTILES.length).toBeGreaterThanOrEqual(6);
    expect(NPCS.length).toBeGreaterThanOrEqual(8);
    expect(EFFECTS.length).toBeGreaterThanOrEqual(6);
  });

  it("every room declares at least one exit (no orphans)", () => {
    const orphans = ROOMS.filter((r) => Object.keys(r.exits).length === 0);
    expect(orphans).toEqual([]);
  });

  it("townsquare connects to all four cardinal directions", () => {
    const square = ROOMS.find((r) => r.enumKey === "TOWNSMEE_TOWNSQUARE");
    expect(square).toBeDefined();
    if (!square) return;
    expect(Object.keys(square.exits).sort()).toEqual([
      "east",
      "north",
      "south",
      "west",
    ]);
  });
});

describe("diagonal exits are usable end to end", () => {
  // The issue's actual "done when": a seeded room with a diagonal exit is
  // walkable. Asserting the parser alone would not have caught a fixture that
  // named a direction the world could not resolve.
  it("Townsmee has at least one diagonal, wired both ways", () => {
    const byKey = new Map(ROOMS.map((r) => [r.enumKey, r]));
    const smithy = byKey.get("TOWNSMEE_BLACKSMITH");
    const market = byKey.get("TOWNSMEE_MARKET");

    expect(smithy?.exits.southeast).toBe("TOWNSMEE_MARKET");
    expect(market?.exits.northwest).toBe("TOWNSMEE_BLACKSMITH");
  });

  it("the diagonal a player types resolves to the room the fixture names", () => {
    const byKey = new Map(ROOMS.map((r) => [r.enumKey, r]));
    const smithy = byKey.get("TOWNSMEE_BLACKSMITH")!;

    // Exactly what the command processor does: parse, then look the parsed
    // direction up in the room's exits. This is the step that used to break —
    // `se` never became `southeast`, so the lookup was never attempted.
    const parsed = parseCommand("se");
    expect(parsed.verb).toBe("move");
    expect(smithy.exits[parsed.args[0]!]).toBe("TOWNSMEE_MARKET");
  });

  it("every direction any fixture uses is one the parser knows", () => {
    // Otherwise a fixture can name an exit no player can ever type, and
    // nothing fails — the room is simply unreachable in that direction.
    const used = new Set<string>();
    for (const room of ROOMS) {
      for (const dir of Object.keys(room.exits)) used.add(dir);
    }
    for (const dir of used) {
      expect(parseCommand(dir)).toEqual({
        verb: "move",
        args: [dir],
        rest: dir,
      });
    }
  });
});
