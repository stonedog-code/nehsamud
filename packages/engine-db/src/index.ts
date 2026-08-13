/**
 * Public surface of `@nehsamud/engine-db`.
 *
 * Consumers (the NehsaMUD engine, and any host embedding it)
 * call `createMudPrismaClient({ databaseUrl })` to get back a
 * Prisma client wired through the @prisma/adapter-pg adapter
 * pattern. We don't ship a global singleton because the MUD process
 * boots a single client at startup and shutdown isn't shared across
 * test harnesses.
 *
 * The `MUD_DATABASE_URL` env var is the canonical runtime source —
 * Phase 2 callers read it from process.env and pass it explicitly,
 * rather than this module reaching for the env so tests can inject
 * a different URL without juggling `process.env` state.
 *
 * Generated client lives at `./generated/client/` (gitignored).
 * Schema generator targets that path explicitly so this package's
 * client doesn't share the workspace-root `node_modules/.prisma/client`
 * location with hopper-db.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/client/index.js";

export interface CreateMudPrismaClientOptions {
  /** Full Postgres connection string. The MUD process pulls this
   * from `MUD_DATABASE_URL` at boot. */
  databaseUrl: string;
  /** Optional log levels forwarded to PrismaClient. Defaults to
   * `["error", "warn"]` so query spam doesn't fill the container
   * log stream. */
  log?: Array<"info" | "query" | "warn" | "error">;
}

export function createMudPrismaClient(
  options: CreateMudPrismaClientOptions,
): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.databaseUrl });
  return new PrismaClient({
    adapter,
    log: options.log ?? ["error", "warn"],
  });
}

export { PrismaClient } from "../generated/client/index.js";
export { Prisma } from "../generated/client/index.js";
