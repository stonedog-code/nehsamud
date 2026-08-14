/**
 * Spawn points refill; a killed hostile comes back.
 *
 * Before this, the boot loop spawned from the fixtures and forgot where each
 * one came from, so the first kill emptied that place permanently. A world
 * that only ever gets quieter cannot support levelling at any size, which is
 * why NEH-664 lists respawn as the prerequisite for every other answer in it.
 *
 * Time is INJECTED throughout. Respawn is evaluated when a player acts, not
 * on a background timer — the same choice `rest` makes — so these tests can
 * assert the ninety-second delay without waiting ninety seconds or reaching
 * for fake timers.
 */

import { RESPAWN_DELAY_MS, WorldState } from "../world/world-state.js";
import type { CachedHostile, CachedRoom } from "../world/world-state.js";

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

const WOLF: CachedHostile = {
  id: "hostile-wolf",
  slug: "wolf",
  name: "Wolf",
  description: "Lean and hungry.",
  level: 2,
  baseHp: 14,
  baseDamage: 3,
  experience: 35,
  tags: ["beast"],
};

/** A world whose clock this test drives by hand. */
function build(mode: "pve" | "exploration" = "pve") {
  let now = 1_000_000;
  const world = new WorldState(mode, () => now);
  world.hydrate([SQUARE], [], [WOLF]);
  return {
    world,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("spawn points", () => {
  it("puts a hostile there when registered, and remembers the place", () => {
    const { world } = build();
    const instance = world.registerSpawnPoint("wolf", SQUARE.id);
    expect(instance).toBeDefined();
    expect(world.spawnPointCount()).toBe(1);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("registers nothing in a world that has no hostiles", () => {
    // Exploration. `spawnHostile` throws there by design, so registering a
    // point must refuse quietly rather than take the boot down — the boot
    // loop runs the same fixtures for every mode.
    const { world } = build("exploration");
    expect(world.registerSpawnPoint("wolf", SQUARE.id)).toBeUndefined();
    expect(world.spawnPointCount()).toBe(0);
    expect(world.respawnDue()).toEqual([]);
  });
});

describe("respawn", () => {
  it("leaves the room empty until the delay has passed", () => {
    const { world, advance } = build();
    const wolf = world.registerSpawnPoint("wolf", SQUARE.id)!;
    world.damageHostile(wolf.instanceId, 999);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(0);

    // One millisecond short. Clearing a room has to mean something for a
    // while, or the verb that cleared it did nothing.
    advance(RESPAWN_DELAY_MS - 1);
    expect(world.respawnDue()).toEqual([]);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(0);
  });

  it("refills the room once it has", () => {
    const { world, advance } = build();
    const wolf = world.registerSpawnPoint("wolf", SQUARE.id)!;
    world.damageHostile(wolf.instanceId, 999);

    advance(RESPAWN_DELAY_MS);
    const returned = world.respawnDue();
    expect(returned).toHaveLength(1);
    expect(returned[0]!.name).toBe("Wolf");
    expect(returned[0]!.currentHp).toBe(WOLF.baseHp);
    // A NEW instance, not the corpse: full health, its own id.
    expect(returned[0]!.instanceId).not.toBe(wolf.instanceId);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("refills a point exactly once, however often it is asked", () => {
    // The failure this guards is a room filling with wolves on every
    // command — the point is occupied again, so it is no longer due.
    const { world, advance } = build();
    const wolf = world.registerSpawnPoint("wolf", SQUARE.id)!;
    world.damageHostile(wolf.instanceId, 999);
    advance(RESPAWN_DELAY_MS);

    expect(world.respawnDue()).toHaveLength(1);
    expect(world.respawnDue()).toEqual([]);
    advance(RESPAWN_DELAY_MS * 10);
    expect(world.respawnDue()).toEqual([]);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("does nothing for a point that was never emptied", () => {
    const { world, advance } = build();
    world.registerSpawnPoint("wolf", SQUARE.id);
    advance(RESPAWN_DELAY_MS * 5);
    expect(world.respawnDue()).toEqual([]);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("restarts the clock on each kill, so a cleared room stays clear", () => {
    const { world, advance } = build();
    const first = world.registerSpawnPoint("wolf", SQUARE.id)!;
    world.damageHostile(first.instanceId, 999);
    advance(RESPAWN_DELAY_MS);
    const second = world.respawnDue()[0]!;

    world.damageHostile(second.instanceId, 999);
    advance(RESPAWN_DELAY_MS - 1);
    expect(world.respawnDue()).toEqual([]);
    advance(1);
    expect(world.respawnDue()).toHaveLength(1);
  });

  it("survives the room or the hostile being pruned out from under it", () => {
    // The seed removes catalog content the fixtures no longer declare. A
    // point left pointing at a deleted room must be skipped, not thrown on:
    // a world missing one wolf beats a dispatch that dies mid-command.
    const { world, advance } = build();
    const wolf = world.registerSpawnPoint("wolf", SQUARE.id)!;
    world.damageHostile(wolf.instanceId, 999);
    advance(RESPAWN_DELAY_MS);

    // Re-hydrate without the room the point refers to.
    world.hydrate([], [], [WOLF]);
    expect(() => world.respawnDue()).not.toThrow();
    expect(world.respawnDue()).toEqual([]);
  });

  it("forgets its points when the world reloads", () => {
    // They are re-registered from the pack by whoever boots the world;
    // keeping stale ones would refill rooms that may no longer exist.
    const { world } = build();
    world.registerSpawnPoint("wolf", SQUARE.id);
    expect(world.spawnPointCount()).toBe(1);
    world.hydrate([SQUARE], [], [WOLF]);
    expect(world.spawnPointCount()).toBe(0);
  });

  it("does not resurrect something spawned outside a point", () => {
    // A bare `spawnHostile` — a test, a future summon — belongs nowhere, so
    // nothing refills when it dies.
    const { world, advance } = build();
    const loose = world.spawnHostile("wolf", SQUARE.id);
    world.damageHostile(loose.instanceId, 999);
    advance(RESPAWN_DELAY_MS * 2);
    expect(world.respawnDue()).toEqual([]);
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(0);
  });
});
