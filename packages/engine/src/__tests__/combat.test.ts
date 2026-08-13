/**
 * Phase 5 combat: attack handler + monster spawn/damage/respawn.
 *
 * Pure unit tests against a hydrated WorldState; no DB, no sockets.
 */

import { dispatch } from "../commands/dispatch.js";
import { PLAYER_BASE_DAMAGE } from "../commands/handlers/attack.js";
import { parseCommand } from "../commands/parser.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { SessionState } from "../world/session.js";
import type {
  CachedMonster,
  CachedRoom,
} from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";

function buildWorld(): WorldState {
  const square: CachedRoom = {
    id: "room-square",
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description: "Cobbles + fountain.",
    exits: { south: "room-lower" },
    environment: "townsmee",
    imageName: null,
  };
  const lower: CachedRoom = {
    id: "room-lower",
    enumKey: "TOWNSMEE_LOWER_QUARTER",
    name: "Lower Quarter",
    description: "Run-down district.",
    exits: { north: "room-square" },
    environment: "townsmee",
    imageName: null,
  };
  const goblin: CachedMonster = {
    id: "monster-goblin",
    slug: "goblin",
    name: "Goblin",
    description: "Wiry green creature.",
    level: 1,
    baseHp: 8,
    baseDamage: 2,
    experience: 20,
    alignment: "evil",
    mobType: "humanoid",
  };
  const ogre: CachedMonster = {
    id: "monster-ogre",
    slug: "ogre",
    name: "Ogre",
    description: "Nine feet of slack-jawed muscle.",
    level: 5,
    baseHp: 45,
    baseDamage: 50, // intentionally lethal vs. baseline player
    experience: 120,
    alignment: "evil",
    mobType: "humanoid",
  };
  // Explicitly PVE: this file is about combat, and a world defaults to
  // exploration, which has no monsters to fight.
  const w = new WorldState("pve");
  w.hydrate([square, lower], [], [goblin, ogre]);
  return w;
}

function newSession(roomId: string): SessionState {
  return {
    userId: "u-1",
    currentRoomId: roomId,
    currentHp: DEFAULT_MAX_HP,
    maxHp: DEFAULT_MAX_HP,
    experience: 0,
    defeated: false,
  };
}

/* ── World spawn/damage/despawn ───────────────────────────────── */

describe("WorldState — monster lifecycle", () => {
  it("spawnMonster places a fresh instance in the room with full HP", async () => {
    const w = buildWorld();
    const inst = w.spawnMonster("goblin", "room-lower");
    expect(inst.currentHp).toBe(8);
    expect(inst.maxHp).toBe(8);
    expect(w.getMonstersInRoom("room-lower")).toHaveLength(1);
    expect(w.liveMonsterCount()).toBe(1);
  });

  it("damageMonster reduces hp and despawns at zero", async () => {
    const w = buildWorld();
    const inst = w.spawnMonster("goblin", "room-lower");
    expect(w.damageMonster(inst.instanceId, 3)).toBe(5);
    expect(w.damageMonster(inst.instanceId, 99)).toBe(0);
    expect(w.getMonstersInRoom("room-lower")).toEqual([]);
    expect(w.liveMonsterCount()).toBe(0);
  });

  it("findMonsterInRoom matches by slug, instanceId, name, and first-name", async () => {
    const w = buildWorld();
    const inst = w.spawnMonster("goblin", "room-lower");
    expect(w.findMonsterInRoom("goblin", "room-lower")?.instanceId).toBe(
      inst.instanceId,
    );
    expect(w.findMonsterInRoom(inst.instanceId, "room-lower")?.slug).toBe(
      "goblin",
    );
    expect(w.findMonsterInRoom("Goblin", "room-lower")?.slug).toBe("goblin");
    expect(w.findMonsterInRoom("ogre", "room-lower")).toBeUndefined();
    expect(w.findMonsterInRoom("", "room-lower")).toBeUndefined();
  });

  it("spawnMonster throws on unknown slug or room", async () => {
    const w = buildWorld();
    expect(() => w.spawnMonster("dragon", "room-lower")).toThrow(
      /unknown monster slug/,
    );
    expect(() => w.spawnMonster("goblin", "room-void")).toThrow(
      /unknown roomId/,
    );
  });
});

/* ── attack handler ───────────────────────────────────────────── */

describe("attack handler", () => {
  it("asks for a target when no arg is given", async () => {
    const w = buildWorld();
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("attack"),
    })).response.lines;
    expect(lines.join(" ")).toBe("Attack what?");
  });

  it("refuses when no matching monster is in the room", async () => {
    const w = buildWorld();
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("attack ghost"),
    })).response.lines;
    expect(lines.join(" ")).toContain('no "ghost" here');
  });

  it("does player damage then monster counter on a survived swing", async () => {
    const w = buildWorld();
    w.spawnMonster("goblin", "room-lower");
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("attack goblin"),
    })).response.lines;
    expect(lines[0]).toContain(`for ${PLAYER_BASE_DAMAGE} damage`);
    expect(lines.some((l) => l.includes("HP left"))).toBe(true);
    expect(lines.some((l) => l.includes("hits you for"))).toBe(true);
    // PLAYER_BASE_DAMAGE=5, goblin baseHp=8 → goblin alive at 3
    expect(w.getMonstersInRoom("room-lower")).toHaveLength(1);
    expect(session.currentHp).toBe(DEFAULT_MAX_HP - 2);
  });

  it("kills the monster + awards XP when player damage equals or exceeds HP", async () => {
    const w = buildWorld();
    w.spawnMonster("goblin", "room-lower"); // 8 HP
    w.spawnMonster("goblin", "room-lower"); // a second one
    const session = newSession("room-lower");
    // Two swings: 5 + 5 = 10, kills at the second.
    await dispatch({ world: w, session, command: parseCommand("attack goblin") });
    const result = await dispatch({
      world: w,
      session,
      command: parseCommand("attack goblin"),
    });
    expect(result.response.lines.some((l) => l.includes("falls"))).toBe(true);
    expect(session.experience).toBe(20);
    // Second goblin still alive.
    expect(w.getMonstersInRoom("room-lower")).toHaveLength(1);
  });

  it("flips defeated on lethal counter, refuses subsequent attacks", async () => {
    const w = buildWorld();
    w.spawnMonster("ogre", "room-lower"); // 50 dmg per round
    const session = newSession("room-lower");
    const first = await dispatch({
      world: w,
      session,
      command: parseCommand("attack ogre"),
    });
    expect(session.defeated).toBe(true);
    expect(session.currentHp).toBe(0);
    expect(first.response.lines.some((l) => l.includes("collapse"))).toBe(true);

    const second = await dispatch({
      world: w,
      session,
      command: parseCommand("attack ogre"),
    });
    expect(second.response.lines.join(" ")).toContain("on the ground");
  });
});

/* ── look + auto-respawn ──────────────────────────────────────── */

describe("look — auto-respawn from defeated", () => {
  it("respawns to TOWNSMEE_TOWNSQUARE with full HP on look", async () => {
    const w = buildWorld();
    const session = newSession("room-lower");
    session.defeated = true;
    session.currentHp = 0;
    const result = await dispatch({
      world: w,
      session,
      command: parseCommand("look"),
    });
    expect(session.currentRoomId).toBe("room-square");
    expect(session.currentHp).toBe(session.maxHp);
    expect(session.defeated).toBe(false);
    expect(
      result.response.lines.some((l) => l.includes("Town Square")),
    ).toBe(true);
  });
});

/* ── look — surfaces live monsters ────────────────────────────── */

describe("look — monster line", () => {
  it("includes alive monsters with their current/max HP", async () => {
    const w = buildWorld();
    w.spawnMonster("goblin", "room-lower");
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("look"),
    })).response.lines;
    const monsterLine = lines.find((l) => l.startsWith("Monsters here"));
    expect(monsterLine).toBeDefined();
    expect(monsterLine).toContain("Goblin (8/8 HP)");
  });

  it("hides the monster line after the room is cleared", async () => {
    const w = buildWorld();
    const inst = w.spawnMonster("goblin", "room-lower");
    w.damageMonster(inst.instanceId, 999);
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("look"),
    })).response.lines;
    expect(lines.find((l) => l.startsWith("Monsters here"))).toBeUndefined();
  });
});
