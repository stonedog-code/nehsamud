/**
 * Command parser. Turns the raw `CLIENT_MESSAGE.message` string
 * into a structured `{ verb, args, rest }` triple the dispatcher
 * branches on.
 *
 * Rules:
 *   - First whitespace-separated token is the verb, lowercased.
 *   - Single-letter verb shortcuts expand to their canonical
 *     verb (n/s/e/w/u/d → cardinal moves, l → look, i →
 *     inventory). Same compass shortcuts the Python MUD honored.
 *   - Everything after the verb is split into `args` (tokens) and
 *     `rest` (original substring minus the verb). Handlers pick
 *     whichever is more convenient.
 *   - Empty input returns a verb of "" so the dispatcher can
 *     route to a "you didn't type anything" response.
 */

export interface ParsedCommand {
  verb: string;
  /** Whitespace-tokenized argument list. */
  args: string[];
  /** Everything after the verb, preserved as a single string for
   * handlers that need free-text (e.g. `say <message>`). */
  rest: string;
}

/**
 * Every direction the world can use, in COMPASS order.
 *
 * Order matters because `look` renders exits from it. Alphabetical put
 * "northeast" between "north" and "northwest", which reads as a list of words
 * rather than a set of headings — tolerable with four directions, actively
 * confusing with eight. Vertical last, because up and down are not on the
 * compass and a player scanning for a heading should not have them
 * interleaved.
 *
 * Direction names are ENGINE-OWNED and not pack-configurable (PRD-0002 R13):
 * `north` is a mechanic, and renaming it would break both muscle memory and
 * the scripting language.
 */
export const DIRECTIONS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "up",
  "down",
] as const;

export type Direction = (typeof DIRECTIONS)[number];

const DIRECTION_SET: ReadonlySet<string> = new Set(DIRECTIONS);

/** Rank for rendering an exit list in compass order. */
const DIRECTION_ORDER = new Map<string, number>(
  DIRECTIONS.map((d, i) => [d, i]),
);

/**
 * Sort exit names into compass order, with anything unrecognised last and
 * alphabetical among itself — a pack can name an exit `in` or `out` and it
 * still renders predictably rather than disappearing.
 */
export function sortDirections(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ra = DIRECTION_ORDER.get(a);
    const rb = DIRECTION_ORDER.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

const VERB_ALIASES: Record<string, string> = {
  l: "look",
  i: "inventory",
  inv: "inventory",
  n: "north",
  ne: "northeast",
  e: "east",
  se: "southeast",
  s: "south",
  sw: "southwest",
  w: "west",
  nw: "northwest",
  u: "up",
  d: "down",
  // `tell` is the common synonym for whisper. The `'` say-shortcut is a
  // prefix rather than a token, so it is handled in parseCommand itself.
  tell: "whisper",
  q: "quit",
  "?": "help",
  h: "help",
};

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { verb: "", args: [], rest: "" };
  }
  // The classic MUD say-shortcut binds tight: `'hello there` with no space.
  // It cannot be an alias, because aliases map whole tokens and this one is a
  // one-character PREFIX — `'hello` tokenizes as the verb `'hello`. Handled
  // here so `say`'s own parsing stays ordinary.
  if (trimmed.startsWith("'")) {
    const said = trimmed.slice(1).trim();
    return { verb: "say", args: said === "" ? [] : said.split(/\s+/), rest: said };
  }

  const firstSpace = trimmed.indexOf(" ");
  const rawVerb =
    (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const verb = VERB_ALIASES[rawVerb] ?? rawVerb;

  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const args = rest === "" ? [] : rest.split(/\s+/);

  // Bare-direction shortcut: "north" implies "move north" so the
  // command processor can dispatch through a single move handler.
  if (DIRECTION_SET.has(verb)) {
    return { verb: "move", args: [verb], rest: verb };
  }

  return { verb, args, rest };
}
