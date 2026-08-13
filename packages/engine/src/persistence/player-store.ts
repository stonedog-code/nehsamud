/**
 * MudPlayer read/write layer.
 *
 * Phase 7 introduces persistence — until now the session lived in
 * memory and was lost at every disconnect. This module:
 *
 *   - On AUTH, looks up the MudPlayer for the userId or creates a
 *     fresh "Traveler-…" character with the first seeded race +
 *     class. Demo flows don't need character-creation UI; we
 *     just spawn them.
 *   - Loads currentRoomId / currentHp / maxHp / experience from
 *     the player row into the session.
 *   - Persists those fields back to the row after every dispatch.
 *     Save is idempotent: if nothing actually changed since the
 *     last save, the update still runs but writes equal values.
 *     Phase 8 can replace this with a dirty-flag check if write
 *     pressure becomes a real concern.
 *
 * Default character creation picks the first race/class returned
 * by Prisma (which is deterministic with the seed). Phase 10 will
 * wire apps/web's character-creation modal into this path so
 * players can pick their race and class.
 */

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@nehsamud/engine-db";

import { levelForXp } from "../progression.js";
import type { InventoryEntry, SessionState } from "../world/session.js";
import { DEFAULT_MAX_HP } from "../world/session.js";

/**
 * The seven core attributes, post-race/class modifier.
 *
 * Stored on the player row rather than recomputed from race + class on every
 * read, because a levelling or equipment effect will eventually change one
 * without changing either of those.
 */
export interface PlayerAttributes {
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
}

export interface PlayerRecord {
  id: string;
  userId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  /** Display name of the chosen race, e.g. "Human". */
  raceName: string;
  /** Display name of the chosen class, e.g. "Warrior". */
  className: string;
  attributes: PlayerAttributes;
}

/**
 * The columns a PlayerRecord needs, shared by `loadPlayer` and `createPlayer`
 * so the two can never drift into returning different shapes — the reason
 * `statistics` could show a race on one path and `undefined` on the other.
 */
const PLAYER_SELECT = {
  id: true,
  userId: true,
  name: true,
  roomId: true,
  currentHp: true,
  maxHp: true,
  experience: true,
  level: true,
  strength: true,
  intelligence: true,
  wisdom: true,
  charisma: true,
  constitution: true,
  dexterity: true,
  luck: true,
  race: { select: { name: true } },
  class: { select: { name: true } },
} as const;

/** Row → PlayerRecord. The only place the relation shape is unpacked. */
function toRecord(row: {
  id: string;
  userId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
  race: { name: string };
  class: { name: string };
}): PlayerRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    roomId: row.roomId,
    currentHp: row.currentHp,
    maxHp: row.maxHp,
    experience: row.experience,
    level: row.level,
    raceName: row.race.name,
    className: row.class.name,
    attributes: {
      strength: row.strength,
      intelligence: row.intelligence,
      wisdom: row.wisdom,
      charisma: row.charisma,
      constitution: row.constitution,
      dexterity: row.dexterity,
      luck: row.luck,
    },
  };
}

/**
 * Look up the MudPlayer for this user. Returns null when the user
 * doesn't have a character yet — the caller (ws-server.ts) then
 * prompts the client to send a `create <name>` command and routes
 * the response through `createPlayer` below.
 *
 * Replaces the older `loadOrCreatePlayer` which silently spawned a
 * `Traveler-<random8>` character on every first AUTH. That behavior
 * meant the user-facing "first time you log in, pick a character
 * name" flow never had a chance to fire.
 */
export async function loadPlayer(
  prisma: PrismaClient,
  userId: string,
): Promise<PlayerRecord | null> {
  const row = await prisma.mudPlayer.findFirst({
    where: { userId },
    select: PLAYER_SELECT,
  });
  return row ? toRecord(row) : null;
}

/**
 * Create a brand-new MudPlayer at the given spawn room with the
 * provided name. Race + class default to the seed's first playable
 * entries (alphabetical) — the protocol still doesn't ship those
 * choices to the client. When a richer UX wants race/class picking,
 * extend this signature.
 *
 * Throws when:
 *   - The name is empty / blank.
 *   - Another user already owns the name (case-insensitive unique
 *     on `mud_player.name`).
 *   - The seed hasn't run (no playable race / class).
 */
export async function createPlayer(
  prisma: PrismaClient,
  userId: string,
  name: string,
  spawnRoomId: string,
): Promise<PlayerRecord> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("createPlayer: name is required");
  }
  const race = await prisma.mudRace.findFirst({
    where: { playable: true },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  const klass = await prisma.mudClass.findFirst({
    where: { playable: true },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (!race || !klass) {
    throw new Error(
      "createPlayer: no playable race or class found. Run `npm run seed` first.",
    );
  }
  const created = await prisma.mudPlayer.create({
    data: {
      userId,
      name: trimmed,
      raceId: race.id,
      classId: klass.id,
      roomId: spawnRoomId,
      currentHp: DEFAULT_MAX_HP,
      maxHp: DEFAULT_MAX_HP,
      experience: 0,
      lastSeenAt: new Date(),
    },
    select: PLAYER_SELECT,
  });
  return toRecord(created);
}

/**
 * Back-compat wrapper kept for callers (Phase-7 + Phase-8 smoke
 * tests) that still expect "auto-spawn a Traveler character on
 * first call". New code should use `loadPlayer` + `createPlayer`.
 *
 * @deprecated Prefer `loadPlayer` + `createPlayer` so the user-
 * facing character-creation flow gets a chance to run.
 */
export async function loadOrCreatePlayer(
  prisma: PrismaClient,
  userId: string,
  spawnRoomId: string,
): Promise<PlayerRecord> {
  const existing = await loadPlayer(prisma, userId);
  if (existing) return existing;
  return createPlayer(
    prisma,
    userId,
    `Traveler-${randomUUID().slice(0, 8)}`,
    spawnRoomId,
  );
}

/**
 * Persist whatever the latest in-memory session state holds back
 * to the MudPlayer row. Always writes — no diffing yet. Bumps
 * lastSeenAt on every save so "online players" queries can rely
 * on it.
 */
export async function savePlayerState(
  prisma: PrismaClient,
  playerId: string,
  session: Pick<
    SessionState,
    "currentRoomId" | "currentHp" | "maxHp" | "experience"
  > &
    Partial<Pick<SessionState, "level">>,
): Promise<void> {
  await prisma.mudPlayer.update({
    where: { id: playerId },
    data: {
      roomId: session.currentRoomId,
      currentHp: session.currentHp,
      maxHp: session.maxHp,
      experience: session.experience,
      // Derived from experience rather than taken from the session, so the
      // column can never be written inconsistent with the XP beside it — the
      // level is a cache and this is where it gets refreshed. `level` on the
      // session is optional here only so older callers keep compiling.
      level: levelForXp(session.experience),
      lastSeenAt: new Date(),
    },
  });
}

/* ─── Inventory ────────────────────────────────────────────────────
 *
 * Split from savePlayerState because these are different tables with
 * different lifetimes: a player row is one UPDATE, an inventory is a set of
 * rows that can grow and shrink. Folding them together would mean rewriting
 * every inventory row on every movement command.
 */

/** Load a player's carried items. */
export async function loadInventory(
  prisma: PrismaClient,
  playerId: string,
): Promise<InventoryEntry[]> {
  const rows = await prisma.mudInventory.findMany({
    where: { playerId },
    select: { itemId: true, quantity: true, item: { select: { name: true } } },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    name: r.item.name,
    quantity: r.quantity,
  }));
}

/**
 * Replace a player's inventory rows with the session's view.
 *
 * Delete-then-insert inside one transaction rather than diffing. An inventory
 * is a handful of rows, and a diff has to get three cases right (added,
 * removed, quantity changed) where a replace has one. The transaction is what
 * makes it safe: without it a crash between the delete and the insert loses
 * everything the player was carrying.
 */
export async function saveInventory(
  prisma: PrismaClient,
  playerId: string,
  inventory: InventoryEntry[],
): Promise<void> {
  await prisma.$transaction([
    prisma.mudInventory.deleteMany({ where: { playerId } }),
    ...inventory.map((entry) =>
      prisma.mudInventory.create({
        data: {
          playerId,
          itemId: entry.itemId,
          quantity: entry.quantity,
        },
      }),
    ),
  ]);
}

/**
 * Replace what is lying in one room.
 *
 * Room contents persist — an item dropped last week is still on that floor —
 * so this runs whenever a `get` or `drop` changes them. Scoped to the single
 * room the player is in, because rewriting every room's floor on every command
 * would be the obvious way to make this too slow to keep.
 */
export async function saveRoomItems(
  prisma: PrismaClient,
  roomId: string,
  stacks: Array<{ itemId: string; quantity: number }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.mudRoomItem.deleteMany({ where: { roomId } }),
    ...stacks.map((s) =>
      prisma.mudRoomItem.create({
        data: { roomId, itemId: s.itemId, quantity: s.quantity },
      }),
    ),
  ]);
}
