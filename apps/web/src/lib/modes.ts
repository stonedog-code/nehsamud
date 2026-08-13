/**
 * Game modes, as the app presents them.
 *
 * **The capability table is not defined here.** It lives in
 * `@nehsamud/engine` and is re-exported below, because the engine is what
 * actually enforces it — a second copy in the UI would be a copy that can
 * disagree, and the one that disagrees silently is the UI. Before the engine
 * moved into this repo the duplication was unavoidable; now it is not.
 *
 * What genuinely belongs here is *presentation*: the names and descriptions
 * a player reads, and which modes this particular deployment serves.
 */

// Imported from `@nehsamud/engine/modes`, never the package root. The root
// barrel re-exports the WebSocket and HTTP servers, which drag express,
// OpenTelemetry and Prisma in with them — and this module is reached from a
// client component, so the root would put all of that in the browser bundle
// (and fail the build outright, since none of it resolves there). The
// `/modes` entry point is the pure half: constants and types, no imports.
import {
  GAME_MODES,
  MODE_CAPABILITIES,
  capabilitiesFor,
  isGameMode,
  type GameMode,
  type ModeCapabilities,
} from "@nehsamud/engine/modes";

export {
  GAME_MODES,
  MODE_CAPABILITIES,
  capabilitiesFor,
  isGameMode,
  type GameMode,
  type ModeCapabilities,
};

export interface ModeDefinition {
  readonly id: GameMode;
  readonly name: string;
  /** One line, written for a player rather than a developer. */
  readonly tagline: string;
  readonly description: string;
  readonly capabilities: ModeCapabilities;
}

/** Player-facing copy per mode. Capabilities come from the engine. */
const PRESENTATION: Readonly<
  Record<GameMode, Omit<ModeDefinition, "id" | "capabilities">>
> = {
  exploration: {
    name: "Exploration",
    tagline: "Wander the world. Nothing here will hurt you.",
    description:
      "A world with no monsters and no fighting. Walk the town, talk to the " +
      "people who live there, and go as far as you like at your own pace. " +
      "Nothing chases you and nothing runs out.",
  },
  pve: {
    name: "Player vs Environment",
    tagline: "Fight monsters, gain experience, reach level 100.",
    description:
      "The full game against the world. Monsters roam beyond the town walls, " +
      "experience is earned by defeating them, and other players are company " +
      "rather than competition — no one can attack you.",
  },
  pvp: {
    name: "Player vs Player",
    tagline: "Everything PVE has, plus everyone else.",
    description:
      "Other players are the danger. Anyone can attack anyone, and whoever " +
      "wins may take everything the loser was carrying. Your character and " +
      "your levels are never at risk — only what is in your pack.",
  },
};

export const MODES: Readonly<Record<GameMode, ModeDefinition>> =
  Object.fromEntries(
    GAME_MODES.map((id) => [
      id,
      { id, ...PRESENTATION[id], capabilities: capabilitiesFor(id) },
    ]),
  ) as Record<GameMode, ModeDefinition>;

export function modeDefinition(mode: GameMode): ModeDefinition {
  return MODES[mode];
}

/**
 * Which modes this deployment serves, from `NEHSAMUD_MODES`.
 *
 * Distinct from the engine's `MUD_GAME_MODE`, and deliberately so: the
 * engine process runs exactly one mode, while this app is a front end that
 * may offer several. A production Exploration host sets
 * `NEHSAMUD_MODES=exploration` and is then structurally unable to route to
 * the others. The dev site leaves it unset and gets all three, which is the
 * only reason the variable defaults to permissive.
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
