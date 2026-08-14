/**
 * A small in-browser world for the preview build.
 *
 * This is NOT the game engine. It exists so the app shell, the command loop,
 * and the e2e tier are real and testable before the engine extraction lands
 * (see PRD-0001 phase 2). It is deliberately pure and synchronous — no
 * network, no storage — so it can be unit-tested directly.
 *
 * It does honour one thing faithfully: the mode capability table. Combat is
 * refused in Exploration here for the same reason it must be refused in the
 * engine, so the e2e test asserting that refusal is meaningful from day one.
 */

import type { DerivedStats, SelectedOption } from "./catalog";
import { MODES, type GameMode } from "./modes";

export const DIRECTIONS = [
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "up",
  "down",
] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** Short forms players actually type. The engine's parser must accept the
 * same set — PRD-0001 R12. */
export const DIRECTION_ALIASES: Readonly<Record<string, Direction>> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  u: "up",
  d: "down",
};

export interface PreviewRoom {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly exits: Partial<Record<Direction, string>>;
}

export const PREVIEW_ROOMS: Readonly<Record<string, PreviewRoom>> = {
  town_square: {
    key: "town_square",
    name: "Town Square",
    description:
      "A wide cobblestone square. A bronze fountain shaped like a dire wolf " +
      "throws water into the morning air, and wagons move through in every " +
      "direction.",
    exits: {
      north: "sunroad",
      east: "moonroad",
      west: "inn",
      southeast: "market",
    },
  },
  sunroad: {
    key: "sunroad",
    name: "Sunroad",
    description:
      "The town's north road, broad enough for two wagons to pass. Tavern " +
      "signs creak overhead.",
    exits: { south: "town_square" },
  },
  moonroad: {
    key: "moonroad",
    name: "Moonroad",
    description:
      "The east road. A blacksmith's hammer rings somewhere ahead, steady as " +
      "a clock.",
    exits: { west: "town_square", southwest: "market" },
  },
  inn: {
    key: "inn",
    name: "The Quiet Bed",
    description:
      "A worn fireplace burns low in the corner. A map of the town and the " +
      "country beyond stands behind glass. Stairs lead up.",
    exits: { east: "town_square", up: "inn_upstairs" },
  },
  inn_upstairs: {
    key: "inn_upstairs",
    name: "The Quiet Bed — Upstairs",
    description:
      "A hallway of small rooms. A vase of daisies sits on a table by the " +
      "window.",
    exits: { down: "inn" },
  },
  market: {
    key: "market",
    name: "Townsmee Market",
    description:
      "Stalls around a packed-dirt plaza. A merchant nods at you from the " +
      "nearest one.",
    exits: { northwest: "town_square", northeast: "moonroad" },
  },
};

export const START_ROOM = "town_square";

export type LineKind = "room" | "echo" | "system" | "text";

export interface Line {
  readonly kind: LineKind;
  readonly text: string;
}

/**
 * Who the player chose to be.
 *
 * Held on the preview state so the choice is observable in-game. Until this
 * existed, the creation form collected the answers, previewed their effect,
 * and then nothing downstream ever mentioned them again — which is
 * indistinguishable from the choice not being recorded at all.
 *
 * `selection` is one entry per axis the pack declares, in declared order, so
 * the preview describes a character the same way the engine does.
 */
export interface PreviewCharacter {
  readonly name: string;
  readonly selection: readonly SelectedOption[];
  readonly stats: DerivedStats;
}

/** "Elf Mage", or "" for a pack that declares no axes. */
function describeSelection(character: PreviewCharacter): string {
  return character.selection.map((s) => s.option.name).join(" ");
}

export interface PreviewState {
  readonly roomKey: string;
  readonly lines: readonly Line[];
  readonly character: PreviewCharacter;
}

function describeRoom(room: PreviewRoom): Line[] {
  const exits = (Object.keys(room.exits) as Direction[]).sort();
  return [
    { kind: "room", text: room.name },
    { kind: "text", text: room.description },
    {
      kind: "text",
      text:
        exits.length > 0
          ? `Exits: ${exits.join(", ")}.`
          : "There are no obvious exits.",
    },
  ];
}

export function initialState(character: PreviewCharacter): PreviewState {
  const room = PREVIEW_ROOMS[START_ROOM];
  const described = describeSelection(character);
  return {
    roomKey: START_ROOM,
    character,
    lines: [
      {
        kind: "system",
        text: `Welcome, ${character.name}${described ? ` the ${described}` : ""}. Type "help" for a list of commands.`,
      },
      ...describeRoom(room),
    ],
  };
}

/** The character sheet, as the preview can render it. */
function describeCharacter(character: PreviewCharacter): Line[] {
  const described = describeSelection(character);
  return [
    { kind: "room", text: `${character.name} — level 1` },
    // Omitted entirely for a pack with no axes, matching the engine's
    // `statistics`: a blank line where a description would go reads as
    // something that failed to load.
    ...(described ? [{ kind: "text" as const, text: described }] : []),
    {
      kind: "text",
      text: `Health: ${character.stats.hp} of ${character.stats.hp}`,
    },
    { kind: "text", text: `Damage: ${character.stats.damage} per swing` },
  ];
}

const HELP_TEXT = [
  "Movement: north, south, east, west, northeast, northwest, southeast,",
  "          southwest, up, down — or their short forms (n, s, e, w, ne,",
  "          nw, se, sw, u, d).",
  "look    — describe where you are.",
  "stats   — who you are and what it gets you.",
  "help    — show this list.",
].join("\n");

/**
 * Apply one command.
 *
 * Returns a whole new state; the caller replaces rather than mutates. Unknown
 * input is answered rather than ignored — silence reads as a broken game.
 */
export function applyCommand(
  state: PreviewState,
  raw: string,
  mode: GameMode,
): PreviewState {
  const input = raw.trim();
  if (input === "") return state;

  const echo: Line = { kind: "echo", text: `> ${input}` };
  const append = (...lines: Line[]): PreviewState => ({
    roomKey: state.roomKey,
    character: state.character,
    lines: [...state.lines, echo, ...lines],
  });

  const [verbRaw, ...rest] = input.split(/\s+/);
  const verb = verbRaw.toLowerCase();
  const room = PREVIEW_ROOMS[state.roomKey];

  if (verb === "help") {
    return append({ kind: "text", text: HELP_TEXT });
  }

  if (verb === "look" || verb === "l") {
    return append(...describeRoom(room));
  }

  if (verb === "stats" || verb === "statistics" || verb === "stat") {
    return append(...describeCharacter(state.character));
  }

  // Combat is refused in Exploration by capability, not by hiding the verb
  // from the UI — the same rule the engine must enforce (PRD-0001 R4).
  if (verb === "attack" || verb === "kill") {
    if (!MODES[mode].capabilities.combat) {
      return append({
        kind: "system",
        text: "There is no fighting in this world. Nothing here will harm you.",
      });
    }
    return append({
      kind: "system",
      text: "Combat is not available in the preview build.",
    });
  }

  const direction =
    DIRECTION_ALIASES[verb] ??
    ((DIRECTIONS as readonly string[]).includes(verb)
      ? (verb as Direction)
      : undefined);

  // "go north" as well as bare "north".
  const goDirection =
    verb === "go" && rest.length > 0
      ? (DIRECTION_ALIASES[rest[0].toLowerCase()] ??
        ((DIRECTIONS as readonly string[]).includes(rest[0].toLowerCase())
          ? (rest[0].toLowerCase() as Direction)
          : undefined))
      : undefined;

  const heading = direction ?? goDirection;
  if (heading) {
    const target = room.exits[heading];
    if (!target) {
      return append({
        kind: "system",
        text: `You can't go ${heading} from here.`,
      });
    }
    const nextRoom = PREVIEW_ROOMS[target];
    return {
      roomKey: target,
      character: state.character,
      lines: [...state.lines, echo, ...describeRoom(nextRoom)],
    };
  }

  return append({
    kind: "system",
    text: `You don't know how to "${verb}". Type "help" for a list of commands.`,
  });
}
