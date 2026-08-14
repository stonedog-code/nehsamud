import { STARTING_LIVES } from "../progression.js";
import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import {
  addToInventory,
  findInInventory,
  inventoryCount,
  removeFromInventory,
} from "../world/inventory.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { InventoryEntry, SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedItem, CachedRoom } from "../world/world-state.js";

/**
 * Items were seeded, migrated and modelled — and unreachable. `inventory` was
 * a stub that always answered "empty", and with no `get` and no `drop` a
 * player's inventory could never change. These cover the layer that makes the
 * subsystem usable.
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
  slot: "weapon",
  baseValue: 3,
  weight: 1,
};
const COIN: CachedItem = {
  id: "item-coin",
  name: "Copper Coin",
  description: "Thin.",
  type: 5,
  slot: null,
  baseValue: null,
  weight: 1,
};

function buildWorld(): WorldState {
  const w = new WorldState("pve");
  w.hydrate(
    [SQUARE, INN],
    [],
    [],
    [DAGGER, COIN],
    [
      { roomId: SQUARE.id, itemId: DAGGER.id, quantity: 1 },
      { roomId: SQUARE.id, itemId: COIN.id, quantity: 3 },
    ],
  );
  return w;
}

function session(roomId = SQUARE.id): SessionState {
  return {
    userId: "u-1",
    currentRoomId: roomId,
    currentHp: DEFAULT_MAX_HP,
    maxHp: DEFAULT_MAX_HP,
    experience: 0,
    level: 1,
    lives: STARTING_LIVES,
    rebirths: 0,
    inventory: [],
    defeated: false,
    resting: false,
  };
}

const say = async (world: WorldState, s: SessionState, input: string) =>
  (await dispatch({ world, session: s, command: parseCommand(input) })).response
    .lines.join("\n");

/* ── inventory arithmetic ─────────────────────────────────────── */

describe("inventory helpers", () => {
  it("merges into an existing stack rather than adding a second entry", () => {
    const inv: InventoryEntry[] = [];
    addToInventory(inv, { itemId: "a", name: "Coin", quantity: 2 });
    addToInventory(inv, { itemId: "a", name: "Coin", quantity: 3 });
    expect(inv).toHaveLength(1);
    expect(inv[0]!.quantity).toBe(5);
  });

  it("copies the entry in rather than aliasing the caller's object", () => {
    const inv: InventoryEntry[] = [];
    const entry = { itemId: "a", name: "Coin", quantity: 1 };
    addToInventory(inv, entry);
    entry.quantity = 99;
    expect(inv[0]!.quantity).toBe(1);
  });

  it("ignores non-positive quantities", () => {
    const inv: InventoryEntry[] = [];
    addToInventory(inv, { itemId: "a", name: "Coin", quantity: 0 });
    addToInventory(inv, { itemId: "a", name: "Coin", quantity: -5 });
    expect(inv).toHaveLength(0);
  });

  it("removes an emptied stack rather than leaving it at zero", () => {
    // An inventory listing a thing you have none of is a bug report waiting
    // to happen.
    const inv: InventoryEntry[] = [{ itemId: "a", name: "Coin", quantity: 1 }];
    removeFromInventory(inv, "a");
    expect(inv).toHaveLength(0);
  });

  it("decrements a stack of more than one", () => {
    const inv: InventoryEntry[] = [{ itemId: "a", name: "Coin", quantity: 3 }];
    const before = removeFromInventory(inv, "a");
    expect(before?.quantity).toBe(3);
    expect(inv[0]!.quantity).toBe(2);
  });

  it("returns undefined for something not carried", () => {
    expect(removeFromInventory([], "nope")).toBeUndefined();
  });

  it("matches by exact name, prefix, then substring", () => {
    const inv: InventoryEntry[] = [
      { itemId: "a", name: "Rusty Dagger", quantity: 1 },
      { itemId: "b", name: "Copper Coin", quantity: 1 },
    ];
    expect(findInInventory(inv, "rusty")?.itemId).toBe("a");
    expect(findInInventory(inv, "Copper Coin")?.itemId).toBe("b");
    expect(findInInventory(inv, "coin")?.itemId).toBe("b");
    expect(findInInventory(inv, "")).toBeUndefined();
    expect(findInInventory(inv, "sword")).toBeUndefined();
  });

  it("counts stacks, not entries", () => {
    expect(
      inventoryCount([
        { itemId: "a", name: "Coin", quantity: 7 },
        { itemId: "b", name: "Dagger", quantity: 1 },
      ]),
    ).toBe(8);
  });
});

/* ── room contents ────────────────────────────────────────────── */

describe("room items", () => {
  it("merges a dropped item into an existing stack", () => {
    const w = buildWorld();
    w.addItemToRoom(SQUARE.id, COIN.id, 2);
    const coins = w.getItemsInRoom(SQUARE.id).find((s) => s.itemId === COIN.id);
    expect(coins?.quantity).toBe(5);
  });

  it("takes one at a time, not the whole stack", () => {
    // `get coins` silently pocketing everything is the kind of thing a player
    // notices only after it is gone.
    const w = buildWorld();
    w.takeItemFromRoom(SQUARE.id, COIN.id);
    expect(
      w.getItemsInRoom(SQUARE.id).find((s) => s.itemId === COIN.id)?.quantity,
    ).toBe(2);
  });

  it("removes an emptied stack so look never advertises a phantom", () => {
    const w = buildWorld();
    w.takeItemFromRoom(SQUARE.id, DAGGER.id);
    expect(
      w.getItemsInRoom(SQUARE.id).some((s) => s.itemId === DAGGER.id),
    ).toBe(false);
  });

  it("returns undefined when taking from an empty or unknown room", () => {
    const w = buildWorld();
    expect(w.takeItemFromRoom(INN.id, DAGGER.id)).toBeUndefined();
    expect(w.takeItemFromRoom("nowhere", DAGGER.id)).toBeUndefined();
  });

  it("refuses to place an item that is not in the catalog", () => {
    const w = buildWorld();
    expect(() => w.addItemToRoom(SQUARE.id, "ghost", 1)).toThrow(/unknown itemId/);
  });

  it("finds by prefix, the same way inventory does", () => {
    // `drop rusty` must find what `get rusty` picked up.
    const w = buildWorld();
    expect(w.findItemInRoom("rusty", SQUARE.id)?.itemId).toBe(DAGGER.id);
    expect(w.findItemInRoom("COPPER", SQUARE.id)?.itemId).toBe(COIN.id);
  });
});

/* ── the verbs ────────────────────────────────────────────────── */

describe("get and drop", () => {
  it("picks an item up and carries it", async () => {
    const w = buildWorld();
    const s = session();
    expect(await say(w, s, "get rusty")).toContain("You pick up the Rusty Dagger");
    expect(findInInventory(s.inventory, "rusty")).toBeDefined();
    expect(w.findItemInRoom("rusty", SQUARE.id)).toBeUndefined();
  });

  it("completes the round trip the issue asked for", async () => {
    // get → inventory shows it → drop → the room shows it again.
    const w = buildWorld();
    const s = session();

    await say(w, s, "get rusty");
    expect(await say(w, s, "inventory")).toContain("Rusty Dagger");

    expect(await say(w, s, "drop rusty")).toContain("You drop the Rusty Dagger");
    expect(await say(w, s, "inventory")).toContain("aren't carrying anything");
    expect(await say(w, s, "look")).toContain("Rusty Dagger");
  });

  it("drops into the room the player is STANDING in, not where it was found", async () => {
    const w = buildWorld();
    const s = session();
    await say(w, s, "get rusty");
    s.currentRoomId = INN.id;
    await say(w, s, "drop rusty");

    expect(w.findItemInRoom("rusty", INN.id)).toBeDefined();
    expect(w.findItemInRoom("rusty", SQUARE.id)).toBeUndefined();
  });

  it("keeps stack quantities across get and drop", async () => {
    const w = buildWorld();
    const s = session();
    await say(w, s, "get copper");
    await say(w, s, "get copper");
    expect(findInInventory(s.inventory, "copper")?.quantity).toBe(2);
    expect(w.findItemInRoom("copper", SQUARE.id)?.quantity).toBe(1);

    await say(w, s, "drop copper");
    expect(findInInventory(s.inventory, "copper")?.quantity).toBe(1);
    expect(w.findItemInRoom("copper", SQUARE.id)?.quantity).toBe(2);
  });

  it("asks what, rather than guessing, on a bare verb", async () => {
    const w = buildWorld();
    const s = session();
    expect(await say(w, s, "get")).toBe("Get what?");
    expect(await say(w, s, "drop")).toBe("Drop what?");
  });

  it("refuses what is not there, naming what was asked for", async () => {
    const w = buildWorld();
    const s = session();
    expect(await say(w, s, "get sword")).toContain('no "sword" here');
    expect(await say(w, s, "drop sword")).toContain('aren\'t carrying a "sword"');
  });

  it("refuses both while defeated", async () => {
    const w = buildWorld();
    const s = session();
    s.defeated = true;
    expect(await say(w, s, "get rusty")).toContain("on the ground");
    expect(await say(w, s, "drop rusty")).toContain("on the ground");
  });
});

describe("look shows what is on the floor", () => {
  it("lists items with quantities", async () => {
    // Without this line `get` is unusable — a player has no way to learn what
    // is here, and guessing nouns is not a game mechanic.
    const text = await say(buildWorld(), session(), "look");
    expect(text).toContain("Lying here:");
    expect(text).toContain("Rusty Dagger");
    expect(text).toContain("Copper Coin (x3)");
  });

  it("says nothing about items in an empty room", async () => {
    const text = await say(buildWorld(), session(INN.id), "look");
    expect(text).not.toContain("Lying here");
  });
});

describe("help advertises the new verbs", () => {
  it("lists get and drop", async () => {
    // A verb without a help line is a verb players do not discover.
    const text = await say(buildWorld(), session(), "help");
    expect(text).toContain("get <item>");
    expect(text).toContain("drop <item>");
  });
});
