/**
 * Prisma client wiring for the MUD process.
 *
 * One client per process — created at boot, disconnected on
 * SIGTERM. Callers import {`getDb`} after boot to get the shared
 * instance; tests instead call {`createDb`} with an explicit URL
 * so they don't need to mutate `process.env`.
 *
 * The URL comes from `MUD_DATABASE_URL` (Prisma 7 won't accept
 * `url = env(...)` inside `schema.prisma`, so the URL is a runtime
 * concern). When the env var is missing the process refuses to
 * start — running the world against no database is never the
 * intended behavior, and degrading silently would be worse than a
 * loud boot failure.
 */

import {
  createMudPrismaClient,
  type PrismaClient,
} from "@nehsamud/engine-db";

let shared: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (!shared) {
    throw new Error(
      "MUD database client not initialized. Call `await initDb()` during process boot.",
    );
  }
  return shared;
}

export interface InitDbOptions {
  /** Override the env var; tests inject a sqlite-style fake URL or
   * point at an ephemeral Postgres. */
  databaseUrl?: string;
  log?: Array<"info" | "query" | "warn" | "error">;
}

export async function initDb(options: InitDbOptions = {}): Promise<PrismaClient> {
  if (shared) return shared;
  const url = options.databaseUrl ?? process.env.MUD_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MUD_DATABASE_URL is not set. The MUD process requires a Postgres connection — see packages/engine-db/README.md.",
    );
  }
  const client = createMudPrismaClient({ databaseUrl: url, log: options.log });
  // $connect is technically optional (Prisma lazy-connects on first
  // query) but doing it eagerly during boot turns a deferred
  // connection failure into an immediate one, which is much easier
  // to diagnose from the container log stream.
  await client.$connect();
  shared = client;
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (!shared) return;
  await shared.$disconnect();
  shared = undefined;
}

/**
 * Test-only helper. Builds a client without touching the shared
 * singleton, so each test owns its own connection lifecycle.
 */
export function createDb(options: InitDbOptions = {}): PrismaClient {
  const url = options.databaseUrl ?? process.env.MUD_DATABASE_URL;
  if (!url) {
    throw new Error("databaseUrl required");
  }
  return createMudPrismaClient({ databaseUrl: url, log: options.log });
}
