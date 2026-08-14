/**
 * Players fighting players, and what the loser leaves on the ground.
 *
 * The tests that matter most are the REFUSALS. PVP is a mode, and the whole
 * promise of the other two is that this cannot happen in them — a version
 * that works in PVP and also quietly works in Exploration would pass every
 * "does it fight" test in this file and break the only guarantee the
 * Exploration build makes.
 */

import { createRng } from "../combat.js";
import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import { SessionRegistry } from "../world/session.js";
import type { CachedItem, CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";
import type { GameMode } from "../game-mode.js";

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
const COINS: CachedItem = {
  id: "item-coins",
  name: "Coin Pouch",
  description: "Jingles.",
  type: 5,
  slot: null,
  baseValue: null,
  weight: 1,
};

function build(mode: GameMode) {
  const world = new WorldState(mode);
  world.hydrate([SQUARE], [], [], [SWORD, COINS]);
  const sessions = new SessionRegistry();

  const open = (name: string, over: Record<string, unknown> = {}) => {
    const socket = {};
    const s = sessions.open(socket, `u-${name}`, SQUARE.id);
    s.characterName = name;
    s.level = 1;
    s.sheet = {
      options: [],
      strength: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      constitution: 10,
      dexterity: 10,
      luck: 10,
    };
    Object.assign(s, over);
    return s;
  };

  const run = async (actor: ReturnType<typeof open>, input: string) => {
    const result = await dispatch({
      world,
      session: actor,
      sessions,
      command: parseCommand(input),
      // Seeded so a swing lands: hit, no crit, mid variance.
      rng: createRng(7),
    });
    return result.response;
  };

  return { world, sessions, open, run };
}

/** Fight until the victim is down, however many swings that takes. */
async function fightToTheEnd(
  run: (a: never, s: string) => Promise<{ lines: string[] }>,
  attacker: never,
  victimName: string,
): Promise<string[]> {
  let last: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    last = (await run(attacker, `attack ${victimName}`)).lines;
    if (last.join("\n").includes("collapses")) return last;
  }
  throw new Error("victim never fell");
}

describe("attacking another player", () => {
  it("is refused in exploration, as if they were not a target at all", async () => {
    // Not "you cannot attack players here" — the verb itself does not exist
    // in a world without combat, and the Exploration build's promise is that
    // nothing in it can hurt you.
    const { open, run } = build("exploration");
    const bandit = open("Bandit");
    open("Victim");
    const text = (await run(bandit, "attack Victim")).lines.join("\n");
    expect(text).toContain("no fighting in this world");
  });

  it("is refused in pve, where the other player is simply not there", async () => {
    // PVE HAS combat, so the verb resolves — and finds no such target. The
    // message must not hint that players are attackable somewhere, because
    // in this world they are not.
    const { open, run } = build("pve");
    const bandit = open("Bandit");
    const victim = open("Victim");
    const text = (await run(bandit, "attack Victim")).lines.join("\n");
    expect(text).toContain('There\'s no "Victim" here to attack');
    expect(victim.currentHp).toBe(victim.maxHp);
  });

  it("lands in pvp, and tells the victim they were hit", async () => {
    const { open, run } = build("pvp");
    const bandit = open("Bandit");
    const victim = open("Victim");
    const response = await run(bandit, "attack Victim");

    expect(victim.currentHp).toBeLessThan(victim.maxHp);
    // The victim hears about it on their own socket. A fight nobody told
    // you about is indistinguishable from a bug in your client.
    const toVictim = response.broadcasts?.find(
      (b) => b.scope === "user" && b.userId === victim.userId,
    );
    expect(toVictim?.message).toMatch(/hits you|swings at you/);
  });

  it("does not swing back on the victim's behalf", async () => {
    // A monster counter-attacks because it has no other way to act. A
    // player does — including the choice to run — and taking that away
    // would make being attacked a thing that happens TO you rather than a
    // fight you are in.
    const { open, run } = build("pvp");
    const bandit = open("Bandit");
    open("Victim");
    await run(bandit, "attack Victim");
    expect(bandit.currentHp).toBe(bandit.maxHp);
  });

  it("refuses to keep hitting someone already down", async () => {
    const { open, run } = build("pvp");
    const bandit = open("Bandit");
    const victim = open("Victim", { defeated: true });
    const text = (await run(bandit, "attack Victim")).lines.join("\n");
    expect(text).toContain("already on the ground");
    expect(victim.currentHp).toBe(victim.maxHp);
  });
});

describe("what a fallen player leaves", () => {
  it("puts everything they carried on the ground, in a named pile", async () => {
    const { world, open, run } = build("pvp");
    const bandit = open("Bandit");
    const victim = open("Victim", {
      inventory: [
        { itemId: SWORD.id, name: SWORD.name, quantity: 1, type: 1, slot: "weapon", baseValue: 8 },
        { itemId: COINS.id, name: COINS.name, quantity: 3, type: 5, slot: null, baseValue: null },
      ],
    });

    await fightToTheEnd(run as never, bandit as never, "Victim");

    expect(victim.defeated).toBe(true);
    expect(victim.inventory).toEqual([]);
    // On the FLOOR, not in the winner's hands. Looting is a separate choice.
    expect(bandit.inventory).toEqual([]);
    const floor = world.getItemsInRoom(SQUARE.id);
    expect(floor.find((s) => s.itemId === SWORD.id)?.quantity).toBe(1);
    expect(floor.find((s) => s.itemId === COINS.id)?.quantity).toBe(3);
    expect(world.getCorpsesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("marks the victim for the server to write back", async () => {
    // They did not type the command that changed them, so nothing else
    // would save their row — and a restart would hand their belongings back
    // while the winner already had them.
    const { open, run } = build("pvp");
    const bandit = open("Bandit");
    const victim = open("Victim", {
      inventory: [{ itemId: COINS.id, name: COINS.name, quantity: 1, type: 5 }],
    });
    await fightToTheEnd(run as never, bandit as never, "Victim");
    expect(victim.pendingPersist).toBe(true);
  });

  it("leaves no pile for someone who was carrying nothing", async () => {
    // An empty corpse is a thing to loot that yields nothing, which reads
    // as the mechanic being broken rather than the victim being poor.
    const { world, open, run } = build("pvp");
    const bandit = open("Bandit");
    open("Pauper");
    await fightToTheEnd(run as never, bandit as never, "Pauper");
    expect(world.getCorpsesInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("awards no experience for the kill", async () => {
    // Otherwise hunting players is the fastest way to level, and the people
    // farmed are the ones with least reason to stay.
    const { open, run } = build("pvp");
    const bandit = open("Bandit");
    open("Victim");
    await fightToTheEnd(run as never, bandit as never, "Victim");
    expect(bandit.experience).toBe(0);
  });
});

describe("looting", () => {
  async function downedWorld() {
    const ctx = build("pvp");
    const bandit = ctx.open("Bandit");
    const victim = ctx.open("Victim", {
      inventory: [
        { itemId: SWORD.id, name: SWORD.name, quantity: 1, type: 1, slot: "weapon", baseValue: 8 },
        { itemId: COINS.id, name: COINS.name, quantity: 2, type: 5, slot: null, baseValue: null },
      ],
    });
    await fightToTheEnd(ctx.run as never, bandit as never, "Victim");
    return { ...ctx, bandit, victim };
  }

  it("moves the whole pile to whoever takes it", async () => {
    const { world, run, bandit } = await downedWorld();
    const text = (await run(bandit, "loot Victim")).lines.join("\n");
    expect(text).toContain("Short Sword");
    expect(bandit.inventory.find((e) => e.itemId === SWORD.id)?.quantity).toBe(1);
    expect(bandit.inventory.find((e) => e.itemId === COINS.id)?.quantity).toBe(2);
    expect(world.getItemsInRoom(SQUARE.id)).toEqual([]);
    expect(world.getCorpsesInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("is optional — declining leaves everything where it fell", async () => {
    // The decline path is a real requirement, not an absence of one: a
    // winner who walks away must leave a pile that is still there.
    const { world, run, bandit, open } = await downedWorld();
    await run(bandit, "look");
    expect(world.getCorpsesInRoom(SQUARE.id)).toHaveLength(1);
    expect(world.getItemsInRoom(SQUARE.id).length).toBeGreaterThan(0);
    expect(bandit.inventory).toEqual([]);
    void open;
  });

  it("may be done by ANY player present, not only the killer", async () => {
    // NEH-624 §3. A corpse is a thing to race for, not private property.
    const { world, run, open } = await downedWorld();
    const passerby = open("Passerby");
    const text = (await run(passerby, "loot Victim")).lines.join("\n");
    expect(text).toContain("Short Sword");
    expect(passerby.inventory.length).toBeGreaterThan(0);
    expect(world.getCorpsesInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("splits a pile rather than duplicating it when two players race", async () => {
    // The corpse records what was DROPPED, not what is owed. Whatever the
    // first looter took is simply no longer on the floor for the second.
    const { run, open, bandit } = await downedWorld();
    const rival = open("Rival");
    await run(bandit, "loot Victim");
    const second = (await run(rival, "loot Victim")).lines.join("\n");
    expect(second).toMatch(/nothing here belonging to|already gone/i);
    expect(rival.inventory).toEqual([]);
  });

  it("shows the pile in `look`, so it can be found without being told", async () => {
    const { run, bandit } = await downedWorld();
    const text = (await run(bandit, "look")).lines.join("\n");
    expect(text).toContain("Victim's belongings");
  });

  it("names what is lootable when asked without a target", async () => {
    const { run, bandit } = await downedWorld();
    const text = (await run(bandit, "loot")).lines.join("\n");
    expect(text).toContain("Victim");
  });

  it("does not exist in pve, which has combat but no looting", async () => {
    // The capability is narrower than combat, and this is where that
    // matters: a PVE world lets you fight a goblin and never offers to
    // strip a body.
    const { open, run } = build("pve");
    const player = open("Solo");
    const text = (await run(player, "loot someone")).lines.join("\n");
    expect(text).toContain("Nothing here can be looted");
  });

  it("does not exist in exploration either", async () => {
    const { open, run } = build("exploration");
    const player = open("Resident");
    const text = (await run(player, "loot someone")).lines.join("\n");
    expect(text).toContain("Nothing here can be looted");
  });
});
