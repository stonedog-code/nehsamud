/**
 * A whole session, against a real database.
 *
 * The unit tier already covers every one of these behaviours against fakes,
 * and it is good at it. What it structurally cannot answer is whether the
 * PRISMA CALLS ARE VALID AGAINST THE REAL SCHEMA — a fake `findUnique`
 * accepts a `where` clause the database would reject, a fake `create`
 * accepts a nested write no constraint permits, and both stay green through
 * a migration that removed the column underneath.
 *
 * So every assertion here either reads a row back or drives the real
 * socket. Where a unit test asserts on what the handler returned, this
 * asserts on what Postgres now contains.
 */

import {
  bootEngine,
  Client,
  newOwnerId,
  type Harness,
} from "./harness.js";

let engine: Harness;

beforeAll(async () => {
  engine = await bootEngine();
});

afterAll(async () => {
  await engine?.close();
});

/** The first option of each declared axis, whatever the pack declares. */
async function firstChoices(): Promise<Record<string, string>> {
  const groups = await engine.prisma.mudCharacterOptionGroup.findMany({
    orderBy: [{ position: "asc" }, { key: "asc" }],
    select: {
      key: true,
      options: {
        where: { selectable: true },
        orderBy: { name: "asc" },
        select: { slug: true },
        take: 1,
      },
    },
  });
  return Object.fromEntries(
    groups.flatMap((g) => (g.options[0] ? [[g.key, g.options[0].slug]] : [])),
  );
}

describe("the world the engine booted", () => {
  it("loaded its rooms, hostiles and NPCs from Postgres", async () => {
    // The seed ran against this database; the engine read it back. If the
    // schema and the loader disagreed, `world.load` would have thrown here
    // rather than in front of a player.
    expect(engine.world.roomCount()).toBeGreaterThan(0);
    expect(engine.world.npcCount()).toBeGreaterThan(0);
    expect(engine.world.hostileCatalogCount()).toBeGreaterThan(0);

    const rooms = await engine.prisma.mudRoom.count();
    expect(engine.world.roomCount()).toBe(rooms);
  });
});

describe("creating a character", () => {
  it("writes the player and its chosen options in one transaction", async () => {
    const owner = newOwnerId();
    const name = `Integration-${owner.slice(0, 8)}`;
    const choices = await firstChoices();

    const client = await Client.open(engine.url);
    await client.auth(owner);
    const lines = await client.exchange({
      type: "CREATE_CHARACTER",
      name,
      options: choices,
    });
    expect(lines.join("\n")).toContain(`Welcome, ${name}`);

    // The assertion the fakes cannot make: the row is really there, with
    // its options really joined to it.
    const row = await engine.prisma.mudPlayer.findFirst({
      where: { ownerId: owner },
      select: {
        name: true,
        roomId: true,
        currentHp: true,
        maxHp: true,
        strength: true,
        options: {
          select: {
            group: { select: { key: true } },
            option: { select: { slug: true } },
          },
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row!.name).toBe(name);
    expect(row!.roomId).not.toBeNull();
    expect(row!.currentHp).toBe(row!.maxHp);

    const written = Object.fromEntries(
      row!.options.map((o) => [o.group.key, o.option.slug]),
    );
    expect(written).toEqual(choices);

    client.close();
  });

  it("derives attributes rather than taking the column defaults", async () => {
    // Every character had 10 across the board for months because the
    // modifier columns were seeded and never read. A unit test can only
    // prove the function computes; this proves the computed value reached
    // the row.
    const owner = newOwnerId();
    const choices = await firstChoices();
    const client = await Client.open(engine.url);
    await client.auth(owner);
    await client.exchange({
      type: "CREATE_CHARACTER",
      name: `Derived-${owner.slice(0, 8)}`,
      options: choices,
    });

    const row = await engine.prisma.mudPlayer.findFirstOrThrow({
      where: { ownerId: owner },
      select: { maxHp: true, strength: true, constitution: true },
    });

    // Recompute from the option rows the database actually holds, so this
    // compares the engine against the data rather than against a literal
    // that a balance change would falsify.
    const mods = await engine.prisma.mudCharacterOption.findMany({
      where: {
        playerOptions: { some: { player: { ownerId: owner } } },
      },
      select: { strengthMod: true, constitutionMod: true },
    });
    const expectedStrength =
      10 + mods.reduce((sum, m) => sum + m.strengthMod, 0);
    expect(row.strength).toBe(expectedStrength);
    // The starting pool scales with constitution, so it is not the bare
    // schema default either.
    expect(row.maxHp).toBeGreaterThan(0);

    client.close();
  });

  it("refuses a second character with a name already taken", async () => {
    // A UNIQUE constraint, which only a real database enforces.
    const shared = `Twin-${newOwnerId().slice(0, 8)}`;
    const choices = await firstChoices();

    const first = await Client.open(engine.url);
    await first.auth(newOwnerId());
    await first.exchange({
      type: "CREATE_CHARACTER",
      name: shared,
      options: choices,
    });
    first.close();

    const second = await Client.open(engine.url);
    await second.auth(newOwnerId());
    const lines = await second.exchange({
      type: "CREATE_CHARACTER",
      name: shared,
      options: choices,
    });
    expect(lines.join("\n")).toMatch(/name is taken/i);
    expect(await engine.prisma.mudPlayer.count({ where: { name: shared } })).toBe(1);
    second.close();
  });
});

describe("playing, and coming back", () => {
  it("persists movement to the row as the player walks", async () => {
    const owner = newOwnerId();
    const choices = await firstChoices();
    const client = await Client.open(engine.url);
    await client.auth(owner);
    await client.exchange({
      type: "CREATE_CHARACTER",
      name: `Walker-${owner.slice(0, 8)}`,
      options: choices,
    });

    const before = await engine.prisma.mudPlayer.findFirstOrThrow({
      where: { ownerId: owner },
      select: { roomId: true },
    });

    // Walk in whichever direction the spawn actually offers, read from the
    // world rather than assumed — a fixture edit that moved the spawn
    // should not fail this test for the wrong reason.
    const spawn = engine.world.getRoom(before.roomId!);
    const direction = Object.keys(spawn?.exits ?? {})[0];
    expect(direction).toBeDefined();
    await client.type(direction!);

    const after = await engine.prisma.mudPlayer.findFirstOrThrow({
      where: { ownerId: owner },
      select: { roomId: true },
    });
    expect(after.roomId).not.toBe(before.roomId);
    expect(after.roomId).toBe(spawn!.exits[direction!]);

    client.close();
  });

  it("brings the same character back on a reconnect", async () => {
    // The reason persistence exists, and the one thing an in-process fake
    // proves nothing about: a NEW SOCKET, a new session, the same row.
    const owner = newOwnerId();
    const name = `Returner-${owner.slice(0, 8)}`;
    const choices = await firstChoices();

    const first = await Client.open(engine.url);
    await first.auth(owner);
    await first.exchange({
      type: "CREATE_CHARACTER",
      name,
      options: choices,
    });
    const spawn = await engine.prisma.mudPlayer.findFirstOrThrow({
      where: { ownerId: owner },
      select: { roomId: true },
    });
    const direction = Object.keys(
      engine.world.getRoom(spawn.roomId!)?.exits ?? {},
    )[0]!;
    await first.type(direction);
    first.close();

    const second = await Client.open(engine.url);
    await second.auth(owner);
    const stats = (await second.type("statistics")).join("\n");

    expect(stats).toContain(name);
    // No second row: the reconnect loaded, it did not create.
    expect(await engine.prisma.mudPlayer.count({ where: { ownerId: owner } })).toBe(1);
    const row = await engine.prisma.mudPlayer.findFirstOrThrow({
      where: { ownerId: owner },
      select: { roomId: true, lastSeenAt: true },
    });
    expect(row.roomId).toBe(engine.world.getRoom(spawn.roomId!)!.exits[direction]);
    expect(row.lastSeenAt).not.toBeNull();

    second.close();
  });

  it("writes carried items to the inventory table", async () => {
    // `get` moves a row between two tables inside a transaction. A fake
    // agrees with that write whatever the foreign keys say.
    const owner = newOwnerId();
    const choices = await firstChoices();
    const client = await Client.open(engine.url);
    await client.auth(owner);
    await client.exchange({
      type: "CREATE_CHARACTER",
      name: `Carrier-${owner.slice(0, 8)}`,
      options: choices,
    });

    // Find a room that actually has something on its floor, and walk the
    // player straight there rather than hoping the spawn has loot.
    const stack = await engine.prisma.mudRoomItem.findFirst({
      where: { hidden: false },
      select: { roomId: true, item: { select: { name: true } } },
    });
    expect(stack).not.toBeNull();
    await engine.prisma.mudPlayer.updateMany({
      where: { ownerId: owner },
      data: { roomId: stack!.roomId },
    });

    // Reconnect so the session starts in that room.
    client.close();
    const walker = await Client.open(engine.url);
    await walker.auth(owner);
    const firstWord = stack!.item.name.split(" ")[0]!.toLowerCase();
    await walker.type(`get ${firstWord}`);

    const carried = await engine.prisma.mudInventory.findMany({
      where: { player: { ownerId: owner } },
      select: { quantity: true, item: { select: { name: true } } },
    });
    expect(carried.map((c) => c.item.name)).toContain(stack!.item.name);

    walker.close();
  });
});
