/**
 * Game modes.
 *
 * A mode is a property of the *deployment*, resolved on the server from
 * configuration. It is deliberately not something a client can influence —
 * see PRD-0001 R2. The Exploration build is the combat-free build served to
 * older adults, and "the UI doesn't show an attack button" is not a safety
 * property. Only "the server will not spawn a monster and will not register a
 * combat verb" is (R3 + R4).
 *
 * This module is the single place that answers "what is allowed here", so the
 * capability table can be asserted in one unit test rather than rediscovered
 * at every call site.
 */

export const GAME_MODES = ["exploration", "pve", "pvp"] as const;

export type GameMode = (typeof GAME_MODES)[number];

export interface ModeCapabilities {
  /** Monsters are placed in the world at boot. */
  readonly monsters: boolean;
  /** Combat verbs are registered in the dispatcher at all. */
  readonly combat: boolean;
  /** Players may target other players. */
  readonly playerVersusPlayer: boolean;
  /** A winner may take a defeated player's inventory. */
  readonly looting: boolean;
  /** Player-authored automation is offered. */
  readonly scripting: boolean;
}

export interface ModeDefinition {
  readonly id: GameMode;
  readonly name: string;
  /** One line, written for a player rather than a developer. */
  readonly tagline: string;
  readonly description: string;
  readonly capabilities: ModeCapabilities;
}

export const MODES: Readonly<Record<GameMode, ModeDefinition>> = {
  exploration: {
    id: "exploration",
    name: "Exploration",
    tagline: "Wander the world. Nothing here will hurt you.",
    description:
      "A world with no monsters and no fighting. Walk the town, talk to the " +
      "people who live there, and go as far as you like at your own pace. " +
      "Nothing chases you and nothing runs out.",
    capabilities: {
      monsters: false,
      combat: false,
      playerVersusPlayer: false,
      looting: false,
      scripting: false,
    },
  },
  pve: {
    id: "pve",
    name: "Player vs Environment",
    tagline: "Fight monsters, gain experience, reach level 100.",
    description:
      "The full game against the world. Monsters roam beyond the town walls, " +
      "experience is earned by defeating them, and other players are company " +
      "rather than competition — no one can attack you.",
    capabilities: {
      monsters: true,
      combat: true,
      playerVersusPlayer: false,
      looting: false,
      scripting: true,
    },
  },
  pvp: {
    id: "pvp",
    name: "Player vs Player",
    tagline: "Everything PVE has, plus everyone else.",
    description:
      "Other players are the danger. Anyone can attack anyone, and whoever " +
      "wins may take everything the loser was carrying. Your character and " +
      "your levels are never at risk — only what is in your pack.",
    capabilities: {
      monsters: true,
      combat: true,
      playerVersusPlayer: true,
      looting: true,
      scripting: true,
    },
  },
};

export function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" && (GAME_MODES as readonly string[]).includes(value)
  );
}

export function modeDefinition(mode: GameMode): ModeDefinition {
  return MODES[mode];
}

/**
 * Which modes this deployment serves, from `NEHSAMUD_MODES`.
 *
 * A production Exploration host sets `NEHSAMUD_MODES=exploration` and is then
 * structurally unable to route to the others. The dev site — the surface the
 * test tiers drive — leaves it unset and gets all three, which is the only
 * reason the variable defaults to permissive.
 *
 * Unrecognised entries are dropped rather than throwing: a typo in a
 * deployment's env should narrow what is served, never widen it, and never
 * take the process down at boot.
 */
export function enabledModes(
  env: Record<string, string | undefined> = process.env,
): GameMode[] {
  const raw = env.NEHSAMUD_MODES?.trim();
  if (!raw) return [...GAME_MODES];

  const requested = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(isGameMode);

  // Preserve the canonical order regardless of how the env lists them, and
  // de-duplicate. An env naming nothing valid yields an empty list, which
  // callers surface as "this deployment serves no modes" — a loud
  // misconfiguration rather than a silent fallback to everything.
  return GAME_MODES.filter((mode) => requested.includes(mode));
}

export function isModeEnabled(
  mode: GameMode,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return enabledModes(env).includes(mode);
}
