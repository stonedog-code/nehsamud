/**
 * Phase 5 combat: attack handler + hostile spawn/damage/respawn.
 *
 * Pure unit tests against a hydrated WorldState; no DB, no sockets.
 */

import { createRng } from "../combat.js";
import { dispatch } from "../commands/dispatch.js";
import { PLAYER_BASE_DAMAGE } from "../commands/handlers/attack.js";
import {
  HP_PER_LEVEL,
  levelForXp,
  xpForLevel,
  STARTING_LIVES,
} from "../progression.js";
import { parseCommand } from "../commands/parser.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { SessionState } from "../world/session.js";
import type {
  CachedHostile,
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
    area: "townsmee",
    imageName: null,
  };
  const lower: CachedRoom = {
    id: "room-lower",
    enumKey: "TOWNSMEE_LOWER_QUARTER",
    name: "Lower Quarter",
    description: "Run-down district.",
    exits: { north: "room-square" },
    environment: "townsmee",
    area: "townsmee",
    imageName: null,
  };
  const goblin: CachedHostile = {
    id: "hostile-goblin",
    slug: "goblin",
    name: "Goblin",
    description: "Wiry green creature.",
    level: 1,
    baseHp: 8,
    baseDamage: 2,
    experience: 20,
    tags: ["humanoid", "evil"],
  };
  const ogre: CachedHostile = {
    id: "hostile-ogre",
    slug: "ogre",
    name: "Ogre",
    description: "Nine feet of slack-jawed muscle.",
    level: 5,
    baseHp: 45,
    baseDamage: 50, // intentionally lethal vs. baseline player
    experience: 120,
    tags: ["humanoid", "evil"],
  };
  // Explicitly PVE: this file is about combat, and a world defaults to
  // exploration, which has no hostiles to fight.
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
    level: 1,
    lives: STARTING_LIVES,
    rebirths: 0,
    inventory: [],
    defeated: false,
    resting: false,
  };
}

/* ── World spawn/damage/despawn ───────────────────────────────── */

describe("WorldState — hostile lifecycle", () => {
  it("spawnHostile places a fresh instance in the room with full HP", async () => {
    const w = buildWorld();
    const inst = w.spawnHostile("goblin", "room-lower");
    expect(inst.currentHp).toBe(8);
    expect(inst.maxHp).toBe(8);
    expect(w.getHostilesInRoom("room-lower")).toHaveLength(1);
    expect(w.liveHostileCount()).toBe(1);
  });

  it("damageHostile reduces hp and despawns at zero", async () => {
    const w = buildWorld();
    const inst = w.spawnHostile("goblin", "room-lower");
    expect(w.damageHostile(inst.instanceId, 3)).toBe(5);
    expect(w.damageHostile(inst.instanceId, 99)).toBe(0);
    expect(w.getHostilesInRoom("room-lower")).toEqual([]);
    expect(w.liveHostileCount()).toBe(0);
  });

  it("findHostileInRoom matches by slug, instanceId, name, and first-name", async () => {
    const w = buildWorld();
    const inst = w.spawnHostile("goblin", "room-lower");
    expect(w.findHostileInRoom("goblin", "room-lower")?.instanceId).toBe(
      inst.instanceId,
    );
    expect(w.findHostileInRoom(inst.instanceId, "room-lower")?.slug).toBe(
      "goblin",
    );
    expect(w.findHostileInRoom("Goblin", "room-lower")?.slug).toBe("goblin");
    expect(w.findHostileInRoom("ogre", "room-lower")).toBeUndefined();
    expect(w.findHostileInRoom("", "room-lower")).toBeUndefined();
  });

  it("spawnHostile throws on unknown slug or room", async () => {
    const w = buildWorld();
    expect(() => w.spawnHostile("dragon", "room-lower")).toThrow(
      /unknown hostile slug/,
    );
    expect(() => w.spawnHostile("goblin", "room-void")).toThrow(
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

  it("refuses when no matching hostile is in the room", async () => {
    const w = buildWorld();
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("attack ghost"),
    })).response.lines;
    expect(lines.join(" ")).toContain('no "ghost" here');
  });

  it("does player damage then hostile counter on a survived swing", async () => {
    const w = buildWorld();
    w.spawnHostile("goblin", "room-lower");
    const session = newSession("room-lower");
    // Seeded: damage now varies and a swing can miss, so a fixed-damage
    // assertion would be asserting the absence of the feature. Seed 2 lands
    // both blows — player 4 (goblin survives at 8-4), goblin 2.
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("attack goblin"),
      rng: createRng(2),
    })).response.lines;
    expect(lines[0]).toContain("for 4 damage");
    expect(lines.some((l) => l.includes("HP left"))).toBe(true);
    expect(lines.some((l) => l.includes("for 2 damage"))).toBe(true);
    expect(w.getHostilesInRoom("room-lower")).toHaveLength(1);
    expect(session.currentHp).toBe(DEFAULT_MAX_HP - 2);
  });

  it("kills the hostile + awards XP when player damage equals or exceeds HP", async () => {
    const w = buildWorld();
    w.spawnHostile("goblin", "room-lower"); // 8 HP
    w.spawnHostile("goblin", "room-lower"); // a second one
    const session = newSession("room-lower");
    session.currentHp = 10_000; // the kill is the subject, not survival
    // Swing until it dies. Damage varies and blows can miss, so a fixed swing
    // count made this test FLAKY rather than wrong — it passed most runs and
    // failed on the ones where a swing missed.
    const result = { response: { lines: await swingUntilDead(w, session) } };
    expect(result.response.lines.some((l) => l.includes("falls"))).toBe(true);
    expect(session.experience).toBe(20);
    // Second goblin still alive.
    expect(w.getHostilesInRoom("room-lower")).toHaveLength(1);
  });

  it("flips defeated on lethal counter, refuses subsequent attacks", async () => {
    const w = buildWorld();
    w.spawnHostile("ogre", "room-lower"); // 50 dmg per round
    const session = newSession("room-lower");
    // Keep swinging until the ogre's counter lands — it hits for 50 against a
    // 30 HP player, so one landed blow is lethal, but it can miss.
    const rng = createRng(3);
    let first = { response: { lines: [] as string[] } };
    for (let i = 0; i < 50 && !session.defeated; i += 1) {
      first = await dispatch({
        world: w,
        session,
        command: parseCommand("attack ogre"),
        rng,
      });
    }
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

/* ── look — surfaces live hostiles ────────────────────────────── */

describe("look — hostile line", () => {
  it("includes alive hostiles with their current/max HP", async () => {
    const w = buildWorld();
    w.spawnHostile("goblin", "room-lower");
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("look"),
    })).response.lines;
    const hostileLine = lines.find((l) => l.startsWith("Monsters here"));
    expect(hostileLine).toBeDefined();
    expect(hostileLine).toContain("Goblin (8/8 HP)");
  });

  it("hides the hostile line after the room is cleared", async () => {
    const w = buildWorld();
    const inst = w.spawnHostile("goblin", "room-lower");
    w.damageHostile(inst.instanceId, 999);
    const session = newSession("room-lower");
    const lines = (await dispatch({
      world: w,
      session,
      command: parseCommand("look"),
    })).response.lines;
    expect(lines.find((l) => l.startsWith("Monsters here"))).toBeUndefined();
  });
});

/* ── Levelling ────────────────────────────────────────────────────
 *
 * This is what NEH-619 actually turned out to be about. The issue was filed
 * claiming experience was in-memory only; it was not — `savePlayerState` had
 * been writing it and `startSessionAndAutoLook` reloading it all along. What
 * was genuinely missing was every part of LEVELLING: no curve, no level-up,
 * and the `level` column pinned at 1 no matter how much XP a character had.
 *
 * So these are the regression tests. The XP-persistence test in the smoke
 * suite pins behaviour that already worked; these pin behaviour that did not
 * exist.
 */
describe("levelling on a kill", () => {
  it("levels the character up when the award crosses a threshold", async () => {
    const world = buildWorld();
    const goblin = world.spawnHostile("goblin", "room-lower");
    const session = newSession("room-lower");
    // One goblin short of level 2.
    session.experience = xpForLevel(2) - goblin.experience;

    // Swing until it dies. The number of swings is no longer fixed — damage
    // varies and blows can miss — so asserting a count would assert the
    // absence of the feature this file now tests.
    const lines = await swingUntilDead(world, session);

    expect(session.level).toBe(2);
    expect(lines.some((l) => l.includes("reached level 2"))).toBe(true);
    expect(lines.some((l) => l.includes("Maximum health is now"))).toBe(true);
  });

  it("raises current HP with max HP, so levelling is not a penalty", async () => {
    const world = buildWorld();
    const goblin = world.spawnHostile("goblin", "room-lower");
    const session = newSession("room-lower");
    session.experience = xpForLevel(2) - goblin.experience;
    session.currentHp = 400; // survives every counter-attack; HP checked below

    const hpBeforeKill = await swingUntilDeadTrackingHp(world, session);

    expect(session.maxHp).toBe(DEFAULT_MAX_HP + HP_PER_LEVEL);
    // The killing blow takes no counter-attack, so the only change to current
    // HP is the level-up grant.
    expect(session.currentHp).toBe(hpBeforeKill + HP_PER_LEVEL);
  });

  it("says nothing about levelling on a kill that does not cross one", async () => {
    const world = buildWorld();
    world.spawnHostile("goblin", "room-lower");
    const session = newSession("room-lower");

    const lines = await swingUntilDead(world, session);

    expect(session.level).toBe(1);
    expect(lines.some((l) => l.includes("reached level"))).toBe(false);
    expect(session.maxHp).toBe(DEFAULT_MAX_HP);
  });

  it("keeps session.level consistent with session.experience", async () => {
    // The invariant the whole design rests on: level is derived, never an
    // independent counter that can drift from the XP beside it.
    const world = buildWorld();
    const session = newSession("room-lower");
    for (let i = 0; i < 8; i += 1) {
      world.spawnHostile("goblin", "room-lower");
      session.currentHp = 10_000; // survive the grind; levelling is the subject
      await swingUntilDead(world, session);
      expect(session.level).toBe(levelForXp(session.experience));
    }
  });
});

/**
 * Swing until the goblin dies, returning the killing blow's lines.
 *
 * Combat is no longer deterministic in the number of swings — damage varies
 * and blows can miss — so tests about the CONSEQUENCE of a kill must not
 * assert how many attacks it took. Seeded so the sequence is reproducible;
 * bounded so a bug that makes a hostile unkillable fails loudly instead of
 * hanging the suite.
 */
async function swingUntilDead(
  world: WorldState,
  session: SessionState,
  seed = 7,
): Promise<string[]> {
  const rng = createRng(seed);
  for (let i = 0; i < 200; i += 1) {
    const lines = (
      await dispatch({
        world,
        session,
        command: parseCommand("attack goblin"),
        rng,
      })
    ).response.lines;
    if (lines.some((l) => l.includes("falls"))) return lines;
  }
  throw new Error("goblin survived 200 swings — combat cannot resolve");
}

/** As above, but reports current HP immediately before the killing blow. */
async function swingUntilDeadTrackingHp(
  world: WorldState,
  session: SessionState,
  seed = 7,
): Promise<number> {
  const rng = createRng(seed);
  for (let i = 0; i < 200; i += 1) {
    const before = session.currentHp;
    const lines = (
      await dispatch({
        world,
        session,
        command: parseCommand("attack goblin"),
        rng,
      })
    ).response.lines;
    if (lines.some((l) => l.includes("falls"))) return before;
  }
  throw new Error("goblin survived 200 swings — combat cannot resolve");
}
