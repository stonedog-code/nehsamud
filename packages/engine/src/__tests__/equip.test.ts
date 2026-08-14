import { STARTING_LIVES } from "../progression.js";
import { createRng } from "../combat.js";
import { dispatch } from "../commands/dispatch.js";
import {
  equippedArmour,
  equippedInSlot,
  equippedWeapon,
  isEquippable,
} from "../commands/handlers/equip.js";
import { parseCommand } from "../commands/parser.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { CharacterSheet, InventoryEntry, SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedItem, CachedHostile, CachedRoom } from "../world/world-state.js";

/**
 * `equip` / `unequip`.
 *
 * The rule that matters most is the last group: equipping has to reach the
 * combat resolver. A flag that nothing reads is the failure mode this whole
 * verb exists to avoid, and it is invisible from every other test.
 */

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A modest square.",
  exits: {},
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};

const SWORD: CachedItem = {
  id: "item-sword",
  name: "Short Sword",
  description: "Balanced.",
  type: 1,
  slot: "weapon",
  baseValue: 8,
  weight: 3,
};
const MAUL: CachedItem = {
  id: "item-maul",
  name: "Maul",
  description: "Heavy.",
  type: 1,
  slot: "weapon",
  baseValue: 14,
  weight: 9,
};
const HELMET: CachedItem = {
  id: "item-helmet",
  name: "Iron Helmet",
  description: "Riveted.",
  type: 2,
  slot: "head",
  baseValue: 4,
  weight: 3,
};
const SHIELD: CachedItem = {
  id: "item-shield",
  name: "Wooden Shield",
  description: "Banded oak.",
  type: 2,
  // Same TYPE as the helmet, different SLOT. That pairing is the whole
  // point of NEH-658: under the old rule these two displaced each other.
  slot: "shield",
  baseValue: 3,
  weight: 5,
};
const BERRIES: CachedItem = {
  id: "item-berries",
  name: "Berries",
  description: "Edible.",
  type: 3,
  slot: null,
  baseValue: null,
  weight: 1,
};

const GOBLIN: CachedHostile = {
  id: "mon-goblin",
  slug: "goblin",
  name: "a goblin",
  description: "Wiry.",
  level: 1,
  baseHp: 200, // deliberately unkillable, so damage can be measured over swings
  baseDamage: 1,
  experience: 5,
  tags: ["humanoid", "evil"],
};

/**
 * Hits hard enough for armour to be measurable.
 *
 * The goblin above deals 1, and `MIN_DAMAGE_ON_HIT` floors every hit at 1 —
 * so 4 points of protection reduce 1 to 1 and an armour test against it
 * passes or fails for reasons that have nothing to do with armour.
 */
const BRUTE: CachedHostile = {
  id: "mon-brute",
  slug: "brute",
  name: "a brute",
  description: "Enormous.",
  level: 3,
  baseHp: 200,
  baseDamage: 14,
  experience: 20,
  tags: ["humanoid", "evil"],
};

const SHEET: CharacterSheet = {
  options: [

    { groupName: "Race", optionName: "Human" },

    { groupName: "Class", optionName: "Warrior" },

  ],
  strength: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  constitution: 10,
  dexterity: 10,
  luck: 10,
};

function buildWorld(): WorldState {
  const w = new WorldState("pve");
  w.hydrate(
    [SQUARE],
    [],
    [GOBLIN, BRUTE],
    [SWORD, MAUL, HELMET, BERRIES],
    [
      { roomId: SQUARE.id, itemId: SWORD.id, quantity: 1 },
      { roomId: SQUARE.id, itemId: MAUL.id, quantity: 1 },
      { roomId: SQUARE.id, itemId: HELMET.id, quantity: 1 },
      { roomId: SQUARE.id, itemId: BERRIES.id, quantity: 1 },
    ],
  );
  return w;
}

function entry(item: CachedItem, over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    itemId: item.id,
    name: item.name,
    quantity: 1,
    type: item.type,
    slot: item.slot,
    baseValue: item.baseValue,
    ...over,
  };
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
    lives: STARTING_LIVES,
    rebirths: 0,
    inventory: [],
    defeated: false,
    resting: false,
    sheet: SHEET,
    ...over,
  };
}

const run = async (w: WorldState, s: SessionState, input: string) =>
  (await dispatch({ world: w, session: s, command: parseCommand(input) }))
    .response.lines.join("\n");

/* ── the rules ────────────────────────────────────────────────── */

describe("equip", () => {
  it("equips something carried, and says so", async () => {
    const s = session({ inventory: [entry(SWORD)] });
    const text = await run(buildWorld(), s, "equip short");
    expect(text).toContain("You equip the Short Sword.");
    expect(s.inventory[0]?.equipped).toBe(true);
  });

  it("swaps within a slot, naming what came off", async () => {
    const s = session({ inventory: [entry(SWORD, { equipped: true }), entry(MAUL)] });
    const text = await run(buildWorld(), s, "equip maul");
    expect(text).toContain("You put away the Short Sword.");
    expect(text).toContain("You equip the Maul.");
    expect(equippedInSlot(s.inventory, "weapon")?.name).toBe("Maul");
    expect(s.inventory.filter((e) => e.equipped)).toHaveLength(1);
  });

  it("does not disturb a different slot", async () => {
    // Equipping a weapon must not take your helmet off.
    const s = session({
      inventory: [entry(HELMET, { equipped: true }), entry(SWORD)],
    });
    await run(buildWorld(), s, "equip short");
    expect(equippedInSlot(s.inventory, "head")?.name).toBe("Iron Helmet");
    expect(equippedInSlot(s.inventory, "weapon")?.name).toBe("Short Sword");
  });

  it("refuses an item that is not equippable", async () => {
    const s = session({ inventory: [entry(BERRIES)] });
    expect(await run(buildWorld(), s, "equip berries")).toContain(
      "can't equip the Berries",
    );
    expect(s.inventory[0]?.equipped).toBeFalsy();
    expect(isEquippable(entry(BERRIES))).toBe(false);
  });

  it("refuses, rather than crashing, on something not carried", async () => {
    // The original dereferenced found_item.item_type BEFORE its None check,
    // so this raised AttributeError instead of answering.
    const s = session();
    expect(await run(buildWorld(), s, "equip sword")).toContain(
      'aren\'t carrying a "sword"',
    );
  });

  it("matches by prefix, the same way get and drop do", async () => {
    // `get short` worked and `equip short` did not, in the original, for the
    // same item in the same breath.
    const s = session({ inventory: [entry(SWORD)] });
    expect(await run(buildWorld(), s, "equip shor")).toContain("You equip");
  });

  it("says so when it is already equipped", async () => {
    const s = session({ inventory: [entry(SWORD, { equipped: true })] });
    expect(await run(buildWorld(), s, "equip short")).toContain(
      "already have the Short Sword equipped",
    );
  });

  it("asks what, on a bare verb", async () => {
    expect(await run(buildWorld(), session(), "equip")).toBe("Equip what?");
  });

  it("is refused while defeated", async () => {
    const s = session({ inventory: [entry(SWORD)], defeated: true });
    expect(await run(buildWorld(), s, "equip short")).toContain("on the ground");
  });
});

describe("unequip", () => {
  it("takes gear off, which the original could never do", async () => {
    const s = session({ inventory: [entry(SWORD, { equipped: true })] });
    expect(await run(buildWorld(), s, "unequip short")).toContain(
      "You put away the Short Sword.",
    );
    expect(equippedWeapon(s.inventory)).toBeUndefined();
  });

  it("refuses something that is not equipped", async () => {
    const s = session({ inventory: [entry(SWORD)] });
    expect(await run(buildWorld(), s, "unequip short")).toContain(
      "isn't equipped",
    );
  });

  it("answers `remove` too", async () => {
    const s = session({ inventory: [entry(HELMET, { equipped: true })] });
    expect(await run(buildWorld(), s, "remove iron")).toContain("You put away");
  });
});

/* ── the accessors combat reads ───────────────────────────────── */

describe("equipped accessors", () => {
  it("report nothing for an empty or unequipped inventory", () => {
    expect(equippedWeapon([])).toBeUndefined();
    expect(equippedArmour([entry(HELMET)])).toEqual([]);
  });

  it("translate an entry into what the resolver wants", () => {
    expect(equippedWeapon([entry(MAUL, { equipped: true })])).toEqual({
      name: "Maul",
      damage: 14,
    });
    expect(equippedArmour([entry(HELMET, { equipped: true })])).toEqual([
      { name: "Iron Helmet", protection: 4 },
    ]);
  });

  it("survive a null baseValue rather than emitting NaN", () => {
    // A catalog row with no base value must read as zero, not poison every
    // damage calculation downstream.
    const odd = entry(SWORD, { equipped: true, baseValue: null });
    expect(equippedWeapon([odd])?.damage).toBe(0);
  });
});

/* ── the part that makes the verb real ────────────────────────── */

describe("equipment reaches combat", () => {
  /** Total damage dealt over N swings against an unkillable goblin. */
  async function damageOver(inventory: InventoryEntry[], swings: number) {
    const w = buildWorld();
    w.spawnHostile("goblin", SQUARE.id);
    const s = session({ inventory });
    const hostile = w.getHostilesInRoom(SQUARE.id)[0]!;
    const startHp = hostile.currentHp;
    for (let i = 0; i < swings; i += 1) {
      // Same seed each run, so the only difference between the two calls is
      // the equipment.
      await dispatch({
        world: w,
        session: s,
        command: parseCommand("attack goblin"),
        rng: createRng(12345 + i),
      });
    }
    return startHp - w.getHostilesInRoom(SQUARE.id)[0]!.currentHp;
  }

  it("a wielded weapon makes the player hit harder", async () => {
    // This is the assertion the whole verb exists for. Without the wiring in
    // attack.ts, `equip` sets a flag nothing reads and these two are equal.
    const unarmed = await damageOver([entry(SWORD)], 8);
    const armed = await damageOver([entry(SWORD, { equipped: true })], 8);
    expect(armed).toBeGreaterThan(unarmed);
  });

  it("a heavier weapon beats a lighter one", async () => {
    const withSword = await damageOver([entry(SWORD, { equipped: true })], 8);
    const withMaul = await damageOver([entry(MAUL, { equipped: true })], 8);
    expect(withMaul).toBeGreaterThan(withSword);
  });

  // Shared by the three armour tests below rather than declared inside one
  // of them: the helmet-and-shield test needs the same measurement, and a
  // second copy is a second thing to keep in step.
  async function damageTaken(inventory: InventoryEntry[]) {
    const w = buildWorld();
    w.spawnHostile("brute", SQUARE.id);
    const s = session({ inventory, currentHp: 5000, maxHp: 5000 });
    for (let i = 0; i < 8; i += 1) {
      await dispatch({
        world: w,
        session: s,
        command: parseCommand("attack brute"),
        rng: createRng(999 + i),
      });
    }
    return 5000 - s.currentHp;
  }

  it("worn armour reduces what the player takes", async () => {
    const bare = await damageTaken([]);
    const helmed = await damageTaken([entry(HELMET, { equipped: true })]);
    expect(helmed).toBeLessThan(bare);
  });

  it("a helmet and a shield are worn AT ONCE, and both reduce damage", async () => {
    // The test NEH-658 exists for, and it asserts BOTH halves deliberately.
    //
    // Either half alone is the failure mode: a slot column without the
    // resolver change lets two pieces be equipped while one is applied — a
    // sheet listing two pieces of armour and using one, which looks like it
    // works. The resolver change without the slots has nothing to sum.
    const s = session({
      inventory: [entry(HELMET), entry(SHIELD)],
    });
    await run(buildWorld(), s, "equip iron");
    await run(buildWorld(), s, "equip wooden");

    // Half one: both are on. Under the old type-bucketed rule the shield
    // would have displaced the helmet — same type, one slot.
    expect(equippedInSlot(s.inventory, "head")?.name).toBe("Iron Helmet");
    expect(equippedInSlot(s.inventory, "shield")?.name).toBe("Wooden Shield");
    expect(s.inventory.filter((e) => e.equipped)).toHaveLength(2);

    // Half two: the second piece actually reaches combat.
    const bare = await damageTaken([]);
    const helmed = await damageTaken([entry(HELMET, { equipped: true })]);
    const both = await damageTaken([
      entry(HELMET, { equipped: true }),
      entry(SHIELD, { equipped: true }),
    ]);
    expect(helmed).toBeLessThan(bare);
    expect(both).toBeLessThan(helmed);
  });

  it("lists every worn piece on the character sheet", async () => {
    const s = session({
      inventory: [
        entry(HELMET, { equipped: true }),
        entry(SHIELD, { equipped: true }),
      ],
    });
    const text = await run(buildWorld(), s, "statistics");
    // The total, then each piece. A single line naming one of them is how a
    // player concludes the other is doing nothing.
    expect(text).toContain("Wearing: 7 protection");
    expect(text).toContain("Iron Helmet (4)");
    expect(text).toContain("Wooden Shield (3)");
  });
});

/* ── surfaces a player reads ──────────────────────────────────── */

describe("equipment is visible", () => {
  it("is marked in the inventory listing", async () => {
    const s = session({
      inventory: [entry(SWORD, { equipped: true }), entry(MAUL)],
    });
    const text = await run(buildWorld(), s, "inventory");
    expect(text).toContain("Short Sword (equipped)");
    expect(text).not.toContain("Maul (equipped)");
  });

  it("appears on the character sheet", async () => {
    const s = session({
      inventory: [
        entry(MAUL, { equipped: true }),
        entry(HELMET, { equipped: true }),
      ],
    });
    const text = await run(buildWorld(), s, "statistics");
    expect(text).toContain("Wielding: Maul (+14 damage)");
    expect(text).toContain("Wearing: 4 protection");
    expect(text).toContain("Iron Helmet (4)");
  });

  it("says so plainly when nothing is equipped", async () => {
    const text = await run(buildWorld(), session(), "statistics");
    expect(text).toContain("Wielding: nothing");
    expect(text).toContain("Wearing: nothing");
  });

  it("is listed in help under both names", async () => {
    const text = await run(buildWorld(), session(), "help");
    expect(text).toContain("equip (eq, wield)");
    expect(text).toContain("unequip (remove)");
  });
});

/* ── picking things up carries what equip needs ───────────────── */

describe("get supplies the catalog facts", () => {
  it("an item picked up off the floor can be equipped", async () => {
    // Without type, SLOT and baseValue riding along from the catalog,
    // everything picked up would be unequippable and nothing would say why.
    //
    // The slot line is not decoration: `get` was not copying it when slots
    // were introduced, which made every item taken off a floor refuse to be
    // equipped — a flat "you can't equip the Short Sword" about a sword the
    // player is visibly holding. This test is what caught it.
    const w = buildWorld();
    const s = session();
    await run(w, s, "get short");
    expect(s.inventory[0]?.type).toBe(1);
    expect(s.inventory[0]?.slot).toBe("weapon");
    expect(s.inventory[0]?.baseValue).toBe(8);
    expect(await run(w, s, "equip short")).toContain("You equip");
  });
});
