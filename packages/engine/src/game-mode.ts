/**
 * Game modes.
 *
 * One engine serves three products, and what separates them is what the
 * server permits — not what the client draws. The Exploration build is the
 * one served to older adults, and its promise is that nothing in the world
 * can hurt you. That promise is only worth something if combat is *absent*
 * from the running process rather than hidden from the interface.
 *
 * So the mode is:
 *   - resolved once, at boot, from the environment;
 *   - attached to the `WorldState` instance, which every command context
 *     already carries, so no handler can be reached without it;
 *   - never readable from, or influenced by, anything a client sends.
 *
 * Enforcement lives in two independent places on purpose — `spawnHostile`
 * refuses to create a hostile, and the dispatcher refuses to resolve a
 * combat verb. Either one alone leaves a reachable path into combat in the
 * build whose entire premise is that there isn't one.
 */

export const GAME_MODES = ["exploration", "pve", "pvp"] as const;

export type GameMode = (typeof GAME_MODES)[number];

export interface ModeCapabilities {
  /** Hostiles may exist in the world. */
  readonly hostiles: boolean;
  /** Combat verbs resolve to a handler. */
  readonly combat: boolean;
  /** Players may target other players. */
  readonly playerVersusPlayer: boolean;
  /** A winner may take a defeated player's inventory. */
  readonly looting: boolean;
  /** Player-authored automation is offered. Off wherever there is no combat
   * — the thing scripting exists to automate is the grind, and a world
   * without hostiles has none. */
  readonly scripting: boolean;
}

export const MODE_CAPABILITIES: Readonly<Record<GameMode, ModeCapabilities>> = {
  exploration: {
    hostiles: false,
    combat: false,
    playerVersusPlayer: false,
    looting: false,
    scripting: false,
  },
  pve: {
    hostiles: true,
    combat: true,
    playerVersusPlayer: false,
    looting: false,
    scripting: true,
  },
  pvp: {
    hostiles: true,
    combat: true,
    playerVersusPlayer: true,
    looting: true,
    scripting: true,
  },
};

/**
 * The mode a process runs in when `MUD_GAME_MODE` is not set.
 *
 * Deliberately the most restrictive one. A deployment that forgets to
 * configure a mode gets a world with no hostiles and no combat, which is
 * safe and obvious; the opposite default would put hostiles in front of the
 * audience least equipped to expect them, and nothing would report it.
 */
export const DEFAULT_GAME_MODE: GameMode = "exploration";

/** Environment variable naming the mode. */
export const GAME_MODE_ENV = "MUD_GAME_MODE";

export function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" && (GAME_MODES as readonly string[]).includes(value)
  );
}

export function capabilitiesFor(mode: GameMode): ModeCapabilities {
  return MODE_CAPABILITIES[mode];
}

/**
 * Resolve the process's mode from the environment.
 *
 * An unset value falls back to {@link DEFAULT_GAME_MODE}. An unrecognised
 * value **throws**, which takes the boot down rather than starting a world
 * nobody chose: a typo that quietly narrowed the mode would leave a PVE host
 * mysteriously hostileless, and a fallback that quietly widened it would be
 * the exact failure this module exists to prevent. Failing at boot puts the
 * mistake in front of the operator while they are still deploying.
 */
export function resolveGameMode(
  env: Record<string, string | undefined> = process.env,
): GameMode {
  const raw = env[GAME_MODE_ENV]?.trim();
  if (!raw) return DEFAULT_GAME_MODE;

  const normalized = raw.toLowerCase();
  if (!isGameMode(normalized)) {
    throw new Error(
      `${GAME_MODE_ENV}="${raw}" is not a valid game mode. ` +
        `Expected one of: ${GAME_MODES.join(", ")}.`,
    );
  }
  return normalized;
}

/**
 * Verbs that constitute combat.
 *
 * The dispatcher consults this before looking a verb up, so a combat verb in
 * a non-combat world is answered without its handler ever being reached.
 * Anything added here must also be added to the mode-aware handler table.
 */
export const COMBAT_VERBS: ReadonlySet<string> = new Set(["attack"]);

/**
 * Verbs that constitute looting.
 *
 * Separate from {@link COMBAT_VERBS} because the capability is separate: a
 * PVE world has combat and no looting. Anything added here must also be
 * added to the looting handler table.
 */
export const LOOTING_VERBS: ReadonlySet<string> = new Set(["loot"]);
