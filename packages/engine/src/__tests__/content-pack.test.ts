/**
 * The content-pack contract, and the validation that makes it a contract.
 *
 * PRD-0002 R5 is the requirement under test: a pack that fails validation
 * stops the boot rather than producing a world with holes in it. The
 * direction matters as much as the check. Before this existed, a pack naming
 * a nonexistent spawn room seeded happily and reported the fault to a
 * *player*, in their transcript, as "(Bug: spawn room missing.)".
 *
 * Every negative case below is a PLANT: the real Townsmee pack is copied,
 * one thing is broken, and the validator is expected to name it. The
 * positive case is asserted in the same file so an over-eager validator that
 * rejected everything could not pass either — a guard that has only ever
 * been observed failing is as untested as one only observed passing.
 */

import {
  assertValidContentPack,
  validateContentPack,
  type ContentPack,
} from "../content/pack.js";
import {
  BUNDLED_PACKS,
  CONTENT_PACK_ENV,
  resolveContentPack,
} from "../content/resolve.js";
import { TOWNSMEE_PACK } from "../content/townsmee.js";

/**
 * A structurally-shared copy of the real pack with one field replaced.
 *
 * Deliberately built FROM the shipped pack rather than from a hand-written
 * miniature. A fixture invented for the test would let the validator agree
 * with a shape production never produces — and the thing being checked here
 * is precisely that the real content survives its own rules.
 */
function packWith(overrides: Partial<ContentPack>): ContentPack {
  return { ...TOWNSMEE_PACK, ...overrides };
}

/** The `at` paths of every problem found, for readable assertions. */
function problemPaths(pack: ContentPack): string[] {
  return validateContentPack(pack).map((p) => p.at);
}

describe("the shipped pack is valid", () => {
  it("Townsmee passes its own validation", () => {
    expect(validateContentPack(TOWNSMEE_PACK)).toEqual([]);
  });

  // The input-set size, printed rather than assumed. A validator run over an
  // empty pack passes every check below for the wrong reason, and the counts
  // are the only signal that the set is real. These are lower bounds, not
  // exact numbers, so adding a room does not fail an unrelated test.
  it("validates a world of real size, not an empty one", () => {
    const exits = TOWNSMEE_PACK.rooms.reduce(
      (n, r) => n + Object.keys(r.exits).length,
      0,
    );
    const options = TOWNSMEE_PACK.characterOptionGroups.reduce(
      (n, g) => n + g.options.length,
      0,
    );
    console.log(
      `[content-pack] validated pack ${JSON.stringify(TOWNSMEE_PACK.key)}: ` +
        `${TOWNSMEE_PACK.areas.length} areas, ${TOWNSMEE_PACK.rooms.length} rooms, ` +
        `${exits} exits, ${TOWNSMEE_PACK.items.length} items, ` +
        `${TOWNSMEE_PACK.hostiles.length} hostiles, ${TOWNSMEE_PACK.npcs.length} npcs, ` +
        `${TOWNSMEE_PACK.effects.length} effects, ` +
        `${TOWNSMEE_PACK.itemPlacements.length} item placements, ` +
        `${TOWNSMEE_PACK.hostileSpawns.length} hostile spawns, ` +
        `${TOWNSMEE_PACK.characterOptionGroups.length} option groups / ${options} options`,
    );
    expect(TOWNSMEE_PACK.rooms.length).toBeGreaterThanOrEqual(30);
    expect(exits).toBeGreaterThanOrEqual(80);
    expect(TOWNSMEE_PACK.items.length).toBeGreaterThanOrEqual(20);
    expect(TOWNSMEE_PACK.npcs.length).toBeGreaterThanOrEqual(5);
    expect(TOWNSMEE_PACK.hostileSpawns.length).toBeGreaterThanOrEqual(15);
    expect(options).toBeGreaterThanOrEqual(10);
  });

  it("declares a spawn room that is one of its own rooms", () => {
    const keys = TOWNSMEE_PACK.rooms.map((r) => r.enumKey);
    expect(keys).toContain(TOWNSMEE_PACK.spawnRoomEnumKey);
  });
});

describe("a pack that names a nonexistent spawn room is rejected", () => {
  // Success criterion 5, and the case with a real cost attached: this is
  // the fault that used to reach a player's transcript.
  it("names the spawn room as the problem", () => {
    const broken = packWith({ spawnRoomEnumKey: "NO_SUCH_ROOM" });
    const problems = validateContentPack(broken);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.at).toBe("spawnRoomEnumKey");
    expect(problems[0]!.message).toContain("NO_SUCH_ROOM");
  });

  it("throws rather than returning, when asserted", () => {
    const broken = packWith({ spawnRoomEnumKey: "NO_SUCH_ROOM" });
    expect(() => assertValidContentPack(broken)).toThrow(/NO_SUCH_ROOM/);
    // The pack is named too — an operator reading a boot log needs to know
    // WHICH world refused, not only that one did.
    expect(() => assertValidContentPack(broken)).toThrow(/townsmee/);
  });
});

describe("a pack whose exits go nowhere is rejected", () => {
  it("names the room and the direction", () => {
    const [first, ...rest] = TOWNSMEE_PACK.rooms;
    const broken = packWith({
      rooms: [{ ...first!, exits: { north: "NOWHERE_AT_ALL" } }, ...rest],
    });
    const problems = validateContentPack(broken);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.at).toBe(`rooms.${first!.enumKey}.exits.north`);
    expect(problems[0]!.message).toContain("NOWHERE_AT_ALL");
  });
});

describe("directions stay engine-owned", () => {
  // PRD-0002 R13. A pack renaming `north` would break both muscle memory
  // and the scripting language, so an invented direction is a content
  // error rather than a new feature.
  it("rejects an exit in a direction the parser does not know", () => {
    const [first, ...rest] = TOWNSMEE_PACK.rooms;
    const broken = packWith({
      rooms: [
        { ...first!, exits: { widdershins: first!.enumKey } },
        ...rest,
      ],
    });
    const problems = validateContentPack(broken);
    expect(problems.map((p) => p.at)).toContain(
      `rooms.${first!.enumKey}.exits.widdershins`,
    );
    expect(problems[0]!.message).toMatch(/engine-owned/);
  });

  it("accepts every direction the parser does know", () => {
    // The inverse. Without it, a validator that rejected ALL directions
    // would pass the test above.
    const [first, ...rest] = TOWNSMEE_PACK.rooms;
    const everyDirection = Object.fromEntries(
      ["north", "northeast", "east", "southeast", "south", "southwest",
        "west", "northwest", "up", "down"].map((d) => [d, first!.enumKey]),
    );
    const pack = packWith({
      rooms: [{ ...first!, exits: everyDirection }, ...rest],
    });
    expect(problemPaths(pack)).toEqual([]);
  });
});

describe("every reference must resolve inside the pack", () => {
  it("rejects a room in an area the pack does not declare", () => {
    const [first, ...rest] = TOWNSMEE_PACK.rooms;
    const broken = packWith({
      rooms: [{ ...first!, area: "somewhere-else" }, ...rest],
    });
    expect(problemPaths(broken)).toContain(`rooms.${first!.enumKey}.area`);
  });

  it("rejects an NPC placed in a room that does not exist", () => {
    const [first, ...rest] = TOWNSMEE_PACK.npcs;
    const broken = packWith({
      npcs: [{ ...first!, roomEnumKey: "GHOST_ROOM" }, ...rest],
    });
    expect(problemPaths(broken)).toContain(`npcs.${first!.slug}.roomEnumKey`);
  });

  it("allows an NPC that is written but not placed", () => {
    // null is legitimate content, not an omission. A validator that
    // rejected it would make an author invent a room to hold a draft.
    const [first, ...rest] = TOWNSMEE_PACK.npcs;
    const pack = packWith({
      npcs: [{ ...first!, roomEnumKey: null }, ...rest],
    });
    expect(problemPaths(pack)).toEqual([]);
  });

  it("rejects an item placed where there is no such item", () => {
    const broken = packWith({
      itemPlacements: [
        { roomEnumKey: TOWNSMEE_PACK.spawnRoomEnumKey, itemName: "Nonexistent Thing" },
      ],
    });
    expect(problemPaths(broken)).toEqual(["itemPlacements[0].itemName"]);
  });

  it("rejects a hostile spawn naming no such hostile", () => {
    const broken = packWith({
      hostileSpawns: [
        { roomEnumKey: TOWNSMEE_PACK.spawnRoomEnumKey, hostileSlug: "jabberwock" },
      ],
    });
    expect(problemPaths(broken)).toEqual(["hostileSpawns[0].hostileSlug"]);
  });
});

describe("duplicate keys are rejected", () => {
  // Not a cosmetic check. The seeder upserts by these strings, so a second
  // room sharing an enumKey does not fail — it silently overwrites the
  // first, and the world quietly loses a room nobody can reach again.
  it("rejects two rooms with the same enumKey", () => {
    const [first, ...rest] = TOWNSMEE_PACK.rooms;
    const broken = packWith({ rooms: [first!, { ...first! }, ...rest] });
    const problems = validateContentPack(broken);
    expect(problems.map((p) => p.at)).toContain("rooms");
    expect(problems[0]!.message).toContain(first!.enumKey);
  });

  it("rejects two hostiles with the same slug", () => {
    const [first, ...rest] = TOWNSMEE_PACK.hostiles;
    const broken = packWith({ hostiles: [first!, { ...first! }, ...rest] });
    expect(problemPaths(broken)).toContain("hostiles");
  });

  it("still allows the same option slug in two different groups", () => {
    // Option slugs are unique WITHIN a group, by design — two axes may both
    // offer a "standard" without colliding.
    const [group] = TOWNSMEE_PACK.characterOptionGroups;
    const clone = { ...group!, key: `${group!.key}-second`, position: 99 };
    const pack = packWith({
      characterOptionGroups: [
        ...TOWNSMEE_PACK.characterOptionGroups,
        clone,
      ],
    });
    expect(problemPaths(pack)).toEqual([]);
  });
});

describe("a world needs rooms", () => {
  it("rejects a pack with none", () => {
    const problems = problemPaths(packWith({ rooms: [] }));
    expect(problems).toContain("rooms");
    // And the spawn is reported too, since it cannot resolve either. A
    // validator that stopped at the first problem would hide the second.
    expect(problems).toContain("spawnRoomEnumKey");
  });
});

describe("every problem is reported, not just the first", () => {
  it("collects them all", () => {
    const [first, second, ...rest] = TOWNSMEE_PACK.rooms;
    const broken = packWith({
      spawnRoomEnumKey: "MISSING",
      rooms: [
        { ...first!, exits: { north: "ALSO_MISSING" } },
        { ...second!, area: "no-such-area" },
        ...rest,
      ],
    });
    const problems = validateContentPack(broken);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(() => assertValidContentPack(broken)).toThrow(/3 problems/);
  });
});

describe("resolving the pack from configuration", () => {
  it("defaults to the bundled world when unset", () => {
    expect(resolveContentPack({})).toBe(TOWNSMEE_PACK);
  });

  it("selects by key, case-insensitively", () => {
    expect(resolveContentPack({ [CONTENT_PACK_ENV]: "TOWNSMEE" })).toBe(
      TOWNSMEE_PACK,
    );
  });

  it("throws on a name it does not know rather than falling back", () => {
    // Same reasoning as resolveGameMode: a typo that quietly served the
    // bundled world would put a fantasy town in front of a care-centre
    // deployment, and nothing would report it.
    expect(() =>
      resolveContentPack({ [CONTENT_PACK_ENV]: "care-centre" }),
    ).toThrow(/names no bundled content pack/);
  });

  it("lists what is actually available in the error", () => {
    expect(() =>
      resolveContentPack({ [CONTENT_PACK_ENV]: "nope" }),
    ).toThrow(new RegExp(Object.keys(BUNDLED_PACKS).join(", ")));
  });

  it("validates whatever it resolves", () => {
    // The point of resolving through here rather than importing the pack
    // directly: there is no supported path to a pack that skipped R5.
    for (const [key, pack] of Object.entries(BUNDLED_PACKS)) {
      expect([key, validateContentPack(pack)]).toEqual([key, []]);
    }
  });
});
