import type { Rng } from "../combat.js";
import { dispatch } from "../commands/dispatch.js";
import {
  BASE_SEARCH_CHANCE,
  MAX_SEARCH_CHANCE,
  MIN_SEARCH_CHANCE,
  SEARCH_BASELINE_WISDOM,
  searchChance,
} from "../commands/handlers/conceal.js";
import { parseCommand } from "../commands/parser.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { CharacterSheet, SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedItem, CachedRoom } from "../world/world-state.js";

/**
 * `search` and `hide` — one mechanic from both ends.
 *
 * The rules that matter most here are the ones about VISIBILITY, because
 * every one of them fails silently: an item that leaks into `look` makes
 * hiding pointless, and a hidden stack dropped by the save path makes it a
 * delete. Neither raises anything.
 */

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A modest square.",
  exits: { north: "room-inn" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};
const INN: CachedRoom = {
  id: "room-inn",
  enumKey: "TOWNSMEE_INN",
  name: "The Quiet Bed",
  description: "Warm.",
  exits: { south: "room-square" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};

const DAGGER: CachedItem = {
  id: "item-dagger",
  name: "Rusty Dagger",
  description: "Notched.",
  type: 1,
  baseValue: 3,
  weight: 1,
};
const COIN: CachedItem = {
  id: "item-coin",
  name: "Copper Coin",
  description: "Thin.",
  type: 5,
  baseValue: null,
  weight: 1,
};

const SHEET: CharacterSheet = {
  options: [

    { groupName: "Race", optionName: "Human" },

    { groupName: "Class", optionName: "Warrior" },

  ],
  strength: 10,
  intelligence: 10,
  wisdom: SEARCH_BASELINE_WISDOM,
  charisma: 10,
  constitution: 10,
  dexterity: 10,
  luck: 10,
};

/** An Rng that returns exactly what the test wants, in order. */
function scriptedRng(...values: number[]): Rng {
  let i = 0;
  return {
    next(): number {
      const v = values[i] ?? values[values.length - 1] ?? 0;
      i += 1;
      return v;
    },
  };
}

/** Always succeeds / always fails, whatever the chance works out to. */
const ALWAYS = scriptedRng(0);
const NEVER = scriptedRng(0.999999);

function buildWorld(
  placements: Array<{
    roomId: string;
    itemId: string;
    quantity: number;
    hidden?: boolean;
  }> = [],
): WorldState {
  const w = new WorldState("pve");
  w.hydrate([SQUARE, INN], [], [], [DAGGER, COIN], placements);
  return w;
}

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    userId: "u-1",
    characterName: "Aria",
    currentRoomId: SQUARE.id,
    currentHp: DEFAULT_MAX_HP,
    maxHp: DEFAULT_MAX_HP,
    experience: 0,
    level: 1,
    inventory: [],
    defeated: false,
    resting: false,
    sheet: SHEET,
    ...over,
  };
}

const run = async (
  w: WorldState,
  s: SessionState,
  input: string,
  rng?: Rng,
) =>
  (
    await dispatch({ world: w, session: s, command: parseCommand(input), rng })
  ).response.lines.join("\n");

/* ── the chance curve ─────────────────────────────────────────── */

describe("searchChance", () => {
  it("gives an average character the base chance", () => {
    expect(searchChance(SEARCH_BASELINE_WISDOM)).toBeCloseTo(
      BASE_SEARCH_CHANCE,
    );
  });

  it("rewards wisdom and punishes its absence", () => {
    expect(searchChance(20)).toBeGreaterThan(searchChance(10));
    expect(searchChance(5)).toBeLessThan(searchChance(10));
  });

  it("never reaches certainty in either direction", () => {
    // The Python original's `rand < perception / 100` made a 100-perception
    // character infallible and a 10-perception one hopeless. Both ends are
    // bounded here.
    expect(searchChance(1000)).toBeLessThanOrEqual(MAX_SEARCH_CHANCE);
    expect(searchChance(-1000)).toBeGreaterThanOrEqual(MIN_SEARCH_CHANCE);
  });

  it("is usable at the attribute values characters actually have", () => {
    // The whole reason for departing from the original: at wisdom 10 its
    // formula found things one time in ten.
    expect(searchChance(SEARCH_BASELINE_WISDOM)).toBeGreaterThan(0.25);
  });
});

/* ── visibility ───────────────────────────────────────────────── */

describe("hidden items are hidden", () => {
  it("does not appear in look", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
    ]);
    const text = await run(w, session(), "look");
    expect(text).not.toContain("Rusty Dagger");
    expect(text).not.toContain("Lying here");
  });

  it("cannot be picked up before it is found", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
    ]);
    const s = session();
    expect(await run(w, s, "get rusty")).toContain('no "rusty" here');
    expect(s.inventory).toHaveLength(0);
  });

  it("keeps hidden and visible stacks of the same item apart", async () => {
    // Merging them would mean stashing one coin conceals the pile.
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 3 },
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 2, hidden: true },
    ]);
    expect(w.getItemsInRoom(SQUARE.id)[0]?.quantity).toBe(3);
    expect(w.getHiddenItemsInRoom(SQUARE.id)[0]?.quantity).toBe(2);
    expect(w.getAllItemsInRoom(SQUARE.id)).toHaveLength(2);
  });
});

/* ── search ───────────────────────────────────────────────────── */

describe("search", () => {
  it("reveals what is hidden on a successful roll", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
    ]);
    const s = session();
    const text = await run(w, s, "search", ALWAYS);
    expect(text).toContain("You found Rusty Dagger!");
    expect(w.getHiddenItemsInRoom(SQUARE.id)).toHaveLength(0);
    expect(await run(w, s, "look")).toContain("Rusty Dagger");
  });

  it("leaves everything hidden on a failed roll", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
    ]);
    const text = await run(w, session(), "search", NEVER);
    expect(text).toContain("find nothing");
    expect(w.getHiddenItemsInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("cannot be used to probe an empty room", async () => {
    // A failed search in a room with something and a failed search in an
    // empty one must be indistinguishable, or `search` becomes a detector
    // that works without ever succeeding.
    const withItem = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
    ]);
    const empty = buildWorld();
    expect(await run(withItem, session(), "search", NEVER)).toBe(
      await run(empty, session(), "search", NEVER),
    );
  });

  it("reveals everything at once rather than one per command", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1, hidden: true },
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 2, hidden: true },
    ]);
    const text = await run(w, session(), "search", ALWAYS);
    expect(text).toContain("Rusty Dagger");
    expect(text).toContain("Copper Coin");
    expect(w.getHiddenItemsInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("merges a revealed stack into one already lying in the open", async () => {
    const w = buildWorld([
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 3 },
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 2, hidden: true },
    ]);
    await run(w, session(), "search", ALWAYS);
    const stacks = w.getItemsInRoom(SQUARE.id);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(5);
  });

  it("succeeds and still reports nothing when the room is genuinely empty", async () => {
    expect(await run(buildWorld(), session(), "search", ALWAYS)).toContain(
      "exhaustive search",
    );
  });

  it("is refused while defeated", async () => {
    const text = await run(
      buildWorld(),
      session({ defeated: true }),
      "search",
      ALWAYS,
    );
    expect(text).toContain("face down");
  });

  it("ends a rest", async () => {
    const s = session({ resting: true });
    await run(buildWorld(), s, "search", ALWAYS);
    expect(s.resting).toBe(false);
  });
});

/* ── hide ─────────────────────────────────────────────────────── */

describe("hide", () => {
  it("takes a carried item off the floor's visible listing", async () => {
    const w = buildWorld([{ roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1 }]);
    const s = session();
    await run(w, s, "get rusty");

    const text = await run(w, s, "hide rusty");
    expect(text).toContain("You conceal the Rusty Dagger");
    expect(s.inventory).toHaveLength(0);
    expect(await run(w, s, "look")).not.toContain("Rusty Dagger");
    expect(w.getHiddenItemsInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("completes the round trip: hide then search finds it again", async () => {
    const w = buildWorld([{ roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1 }]);
    const s = session();
    await run(w, s, "get rusty");
    await run(w, s, "hide rusty");
    expect(await run(w, s, "search", ALWAYS)).toContain("You found Rusty Dagger!");
    expect(await run(w, s, "get rusty")).toContain("You pick up the Rusty Dagger");
  });

  it("hides one at a time, like drop", async () => {
    const w = buildWorld([{ roomId: SQUARE.id, itemId: COIN.id, quantity: 3 }]);
    const s = session();
    await run(w, s, "get copper");
    await run(w, s, "get copper");
    await run(w, s, "hide copper");
    expect(s.inventory[0]?.quantity).toBe(1);
    expect(w.getHiddenItemsInRoom(SQUARE.id)[0]?.quantity).toBe(1);
  });

  it("hides into the room the player is standing in", async () => {
    const w = buildWorld([{ roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1 }]);
    const s = session();
    await run(w, s, "get rusty");
    s.currentRoomId = INN.id;
    await run(w, s, "hide rusty");
    expect(w.getHiddenItemsInRoom(INN.id)).toHaveLength(1);
    expect(w.getHiddenItemsInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("refuses what the player is not carrying", async () => {
    expect(await run(buildWorld(), session(), "hide sword")).toContain(
      'aren\'t carrying a "sword"',
    );
  });

  it("says hiding yourself is not possible yet, rather than doing nothing", async () => {
    // Bare `hide` hid the PLAYER in the original. That needs a stealth model;
    // until there is one, silence would read as a broken verb.
    const text = await run(buildWorld(), session(), "hide");
    expect(text).toContain("Hide what?");
    expect(text).toContain("isn't possible yet");
  });

  it("is refused while defeated", async () => {
    const text = await run(buildWorld(), session({ defeated: true }), "hide x");
    expect(text).toContain("no state to hide");
  });
});

/* ── discoverability ──────────────────────────────────────────── */

describe("help and aliases", () => {
  it("lists both verbs", async () => {
    const text = await run(buildWorld(), session(), "help");
    expect(text).toContain("search (sea)");
    expect(text).toContain("hide (stash)");
  });

  it("accepts sea and stash", async () => {
    const w = buildWorld([{ roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1 }]);
    const s = session();
    expect(await run(w, s, "sea", ALWAYS)).toContain("search");
    await run(w, s, "get rusty");
    expect(await run(w, s, "stash rusty")).toContain("You conceal");
  });

  it("does not alias `s` away from south", async () => {
    // `stash` short-forms in the original included `s`. A player typing a
    // direction who instead stashes their weapon has been badly served.
    const w = buildWorld();
    const s = session();
    await run(w, s, "s");
    expect(s.currentRoomId).toBe(SQUARE.id);
    expect(await run(w, s, "s")).toContain("can't go south");
  });
});
