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

/* ── Character derivation ─────────────────────────────────────── */
export {
  BASE_ATTRIBUTE,
  BASE_MAX_HP,
  BASE_PLAYER_DAMAGE,
  DAMAGE_PER_STRENGTH,
  HP_PER_CONSTITUTION,
  HP_PER_LEVEL,
  HP_PER_LEVEL_PER_CONSTITUTION,
  MIN_ATTRIBUTE,
  baseDamageFor,
  deriveAttributes,
  deriveCharacter,
  maxHpForLevel,
  type AttributeMods,
  type Attributes,
  type DerivedCharacter,
} from "./character.js";

/**
 * The character-creation axes this build's pack declares.
 *
 * Exported so a creation screen can offer exactly what the seed puts in the
 * database, with exactly the modifiers the engine will apply. The web app
 * used to keep its own list with its own hp/damage numbers, which meant the
 * stat preview promised values the engine would never produce.
 *
 * This is a build-time convenience for a client shipped alongside its pack.
 * A client that cannot assume that should read the groups from the database
 * (`listOptionGroups`) instead.
 */
export {
  CHARACTER_OPTION_GROUPS,
  type CharacterOptionFixture,
  type CharacterOptionGroupFixture,
} from "./seed/fixtures/index.js";

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
  type CachedHostile,
  type CachedNpc,
  type CachedRoom,
  type HostileInstance,
} from "./world/world-state.js";
export {
  createPlayer,
  listOptionGroups,
  loadPlayer,
  type CharacterChoice,
  type OptionChoice,
  type OptionGroup,
  type PlayerRecord,
  type SelectedOption,
} from "./persistence/player-store.js";
export {
  DEFAULT_MAX_HP,
  SessionRegistry,
  type CharacterSheet,
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
export {
  RateLimiter,
  BURST_CAPACITY,
  COMMANDS_PER_SECOND,
  throttleMessage,
  type RateLimitDecision,
} from "./rate-limit.js";
export { MudWsServer, type MudWsServerOptions } from "./ws-server.js";
export { createHttpApp, listenHttp } from "./http-server.js";
export {
  verifyHopperToken,
  type AuthResult,
  type VerifyOptions,
} from "./auth.js";

/* ── Scripting ────────────────────────────────────────────────── */
/**
 * The player scripting language (R20–R24).
 *
 * Exported from the root because WHERE IT RUNS IS STILL OPEN (OQ1): a
 * client driving the runner over the WebSocket and the engine driving it
 * in-process are the same loop, so both need to reach it. The language does
 * not change either way.
 */
export {
  DEFAULT_LIMITS,
  STOP_MESSAGES,
  ScriptRunner,
  ScriptSyntaxError,
  parseScript,
  type Program,
  type ScriptLimits,
  type ScriptState,
  type Statement,
  type Step,
  type StopReason,
} from "./scripting/index.js";

/* ── Services ─────────────────────────────────────────────────── */
export { createAiServices, type AiServices } from "./ai/factory.js";
export { currentCapabilities, type Capabilities } from "./capabilities.js";
export { createDb, disconnectDb, getDb, initDb } from "./db.js";
export { initTelemetry } from "./telemetry/setup.js";

/* ── World content ────────────────────────────────────────────── */
export * as fixtures from "./seed/fixtures/index.js";
