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

import type { SessionState } from "../world/session.js";
import { DEFAULT_MAX_HP } from "../world/session.js";

export interface PlayerRecord {
  id: string;
  userId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
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
  return prisma.mudPlayer.findFirst({
    where: { userId },
    select: {
      id: true,
      userId: true,
      name: true,
      roomId: true,
      currentHp: true,
      maxHp: true,
      experience: true,
      level: true,
    },
  });
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
    select: {
      id: true,
      userId: true,
      name: true,
      roomId: true,
      currentHp: true,
      maxHp: true,
      experience: true,
      level: true,
    },
  });
  return created;
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
  >,
): Promise<void> {
  await prisma.mudPlayer.update({
    where: { id: playerId },
    data: {
      roomId: session.currentRoomId,
      currentHp: session.currentHp,
      maxHp: session.maxHp,
      experience: session.experience,
      lastSeenAt: new Date(),
    },
  });
}
