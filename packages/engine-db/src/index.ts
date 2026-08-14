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

/**
 * SSL modes whose meaning is unambiguous, so an operator who wrote one gets
 * exactly what they asked for.
 *
 * `disable` and the `verify-*` family mean the same thing in libpq and in
 * node-postgres. `require`, `prefer` and `allow` do NOT — see below.
 */
const EXPLICIT_SSL_MODES = new Set([
  "disable",
  "verify-ca",
  "verify-full",
]);

/**
 * Hosts that are not reached over a network.
 *
 * A connection to loopback never leaves the machine, so there is no wire to
 * intercept and nothing for TLS to protect. This is not a weakened default —
 * it is the one case where the default's own reasoning does not apply.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(url: URL): boolean {
  // `URL.hostname` strips the brackets IPv6 literals carry in a URL, so both
  // spellings are checked rather than assuming which one arrives.
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Make a Postgres URL work with the pg driver the way its author meant it.
 *
 * THE BUG THIS FIXES. `prisma migrate` and the Prisma *client* reach the
 * database by different roads: migrations go through Prisma's own engine,
 * which negotiates TLS by default, and the client goes through
 * `@prisma/adapter-pg` → node-postgres, which does not. Against RDS — which
 * refuses unencrypted connections at authentication — that produced a split
 * where migrations applied cleanly and every query failed with
 * `P1010: User was denied access on the database`.
 *
 * P1010 reads as a permissions problem and is not one. The credential was
 * always fine: a raw `pg` client with TLS forced on read and wrote happily
 * with the identical connection string. It cost time in three separate
 * pieces of work before anyone connected "denied access" to "no TLS".
 *
 * THE SECOND TRAP. Adding `?sslmode=require` — the value this project's own
 * runbook tells you to use, and what libpq means by "encrypt this" — does
 * not fix it either. node-postgres ≥8.16 reads `sslmode=require` as
 * *verify the certificate too*, so it fails with `P1011: self-signed
 * certificate in certificate chain` against the RDS CA, which Node does not
 * trust out of the box. Its own error text names the escape hatch:
 * `uselibpqcompat=true`.
 *
 * So: restore libpq's meaning for the modes whose meaning changed, and
 * default to encrypting when the URL says nothing at all.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE. libpq's `require` encrypts the
 * connection but does not authenticate the server, so it stops passive
 * eavesdropping and not an active man-in-the-middle. That is the same
 * posture the connection strings in Secrets Manager already assume. To
 * verify properly, set `sslmode=verify-full` explicitly along with the RDS
 * CA bundle — this function leaves that choice alone.
 */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Not a URL we can reason about — hand it back untouched rather than
    // guessing. The driver will produce a better error than we can.
    return databaseUrl;
  }

  // An explicit compatibility choice is never second-guessed.
  if (url.searchParams.has("uselibpqcompat")) return url.toString();

  const mode = url.searchParams.get("sslmode");
  if (mode && EXPLICIT_SSL_MODES.has(mode)) return url.toString();

  if (mode) {
    // require / prefer / allow — the operator meant libpq's meaning.
    url.searchParams.set("uselibpqcompat", "true");
    return url.toString();
  }

  // Nothing said at all, and the host is loopback: leave it alone.
  //
  // THIS COST TWO PRODUCTION DEPLOYMENTS (NEH-710). The line below used to
  // apply to every URL, justified as "every database this connects to is
  // reached over a network" — which is simply not true of the deployment
  // that matters most. HopperGuard runs this engine as a sidecar beside a
  // pgbouncer container and points it at `localhost:6432`; that connection
  // never leaves the container group, and the pooler terminates no TLS. So
  // the engine demanded encryption nobody could offer, failed at boot with
  // "The server does not support SSL connections", and Lightsail rolled the
  // deployment back — twice, for two different people, before anyone read
  // the container log.
  //
  // An operator who writes `sslmode=require` against localhost still gets
  // it: this only governs the case where nothing was said.
  if (isLoopback(url)) return url.toString();

  // Nothing said, and the host is somewhere else. Encrypt: the connection
  // crosses a network, and the managed databases refuse plaintext anyway
  // (NEH-663).
  url.searchParams.set("uselibpqcompat", "true");
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

export function createMudPrismaClient(
  options: CreateMudPrismaClientOptions,
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: normalizeDatabaseUrl(options.databaseUrl),
  });
  return new PrismaClient({
    adapter,
    log: options.log ?? ["error", "warn"],
  });
}

export { PrismaClient } from "../generated/client/index.js";
export { Prisma } from "../generated/client/index.js";
