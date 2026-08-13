/**
 * Public surface of `@nehsamud/engine`.
 *
 * Two ways to consume this package:
 *
 *   - **As a library** (this module) — a host wires the pieces into its own
 *     process. HopperGuard does this: it supplies the Prisma client and the
 *     auth it already has, and pins the mode to `exploration`.
 *   - **As a process** (`./server`) — the standalone deployment, one per
 *     mode, run by `nehsamud-engine`.
 *
 * Everything a host needs is exported here so nobody has to reach into
 * `dist/` subpaths. Deep imports are not part of the contract and will move.
 */

/* ── Modes ────────────────────────────────────────────────────── */
export {
  COMBAT_VERBS,
  DEFAULT_GAME_MODE,
  GAME_MODES,
  GAME_MODE_ENV,
  MODE_CAPABILITIES,
  capabilitiesFor,
  isGameMode,
  resolveGameMode,
  type GameMode,
  type ModeCapabilities,
} from "./game-mode.js";

/* ── World ────────────────────────────────────────────────────── */
export {
  WorldState,
  type CachedMonster,
  type CachedNpc,
  type CachedRoom,
  type MonsterInstance,
} from "./world/world-state.js";
export {
  DEFAULT_MAX_HP,
  SessionRegistry,
  type SessionState,
} from "./world/session.js";

/* ── Commands ─────────────────────────────────────────────────── */
export { dispatch, handlersFor, NO_COMBAT_MESSAGE } from "./commands/dispatch.js";
export { parseCommand, type ParsedCommand } from "./commands/parser.js";
export {
  reply,
  type CommandContext,
  type CommandHandler,
  type CommandResponse,
} from "./commands/types.js";

/* ── Transport ────────────────────────────────────────────────── */
export { MudWsServer, type MudWsServerOptions } from "./ws-server.js";
export { createHttpApp, listenHttp } from "./http-server.js";
export {
  verifyHopperToken,
  type AuthResult,
  type VerifyOptions,
} from "./auth.js";

/* ── Services ─────────────────────────────────────────────────── */
export { createAiServices, type AiServices } from "./ai/factory.js";
export { currentCapabilities, type Capabilities } from "./capabilities.js";
export { createDb, disconnectDb, getDb, initDb } from "./db.js";
export { initTelemetry } from "./telemetry/setup.js";

/* ── World content ────────────────────────────────────────────── */
export * as fixtures from "./seed/fixtures/index.js";
