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

const VERB_ALIASES: Record<string, string> = {
  l: "look",
  i: "inventory",
  inv: "inventory",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  u: "up",
  d: "down",
  q: "quit",
  "?": "help",
  h: "help",
};

const DIRECTIONS = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { verb: "", args: [], rest: "" };
  }
  const firstSpace = trimmed.indexOf(" ");
  const rawVerb =
    (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const verb = VERB_ALIASES[rawVerb] ?? rawVerb;

  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const args = rest === "" ? [] : rest.split(/\s+/);

  // Bare-direction shortcut: "north" implies "move north" so the
  // command processor can dispatch through a single move handler.
  if (DIRECTIONS.has(verb)) {
    return { verb: "move", args: [verb], rest: verb };
  }

  return { verb, args, rest };
}
