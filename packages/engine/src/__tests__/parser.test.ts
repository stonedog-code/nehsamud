import { DIRECTIONS, parseCommand, sortDirections } from "../commands/parser.js";

describe("parseCommand", () => {
  it("returns empty verb for empty input", () => {
    expect(parseCommand("")).toEqual({ verb: "", args: [], rest: "" });
    expect(parseCommand("   ")).toEqual({ verb: "", args: [], rest: "" });
  });

  it("lowercases the verb", () => {
    expect(parseCommand("LOOK").verb).toBe("look");
    expect(parseCommand("Look").verb).toBe("look");
  });

  it("expands single-letter aliases", () => {
    expect(parseCommand("l").verb).toBe("look");
    expect(parseCommand("i").verb).toBe("inventory");
    expect(parseCommand("inv").verb).toBe("inventory");
    expect(parseCommand("q").verb).toBe("quit");
    expect(parseCommand("?").verb).toBe("help");
    expect(parseCommand("h").verb).toBe("help");
  });

  it("expands bare cardinal directions to move", () => {
    expect(parseCommand("north")).toEqual({
      verb: "move",
      args: ["north"],
      rest: "north",
    });
    expect(parseCommand("n")).toEqual({
      verb: "move",
      args: ["north"],
      rest: "north",
    });
    expect(parseCommand("up")).toEqual({
      verb: "move",
      args: ["up"],
      rest: "up",
    });
    expect(parseCommand("u")).toEqual({
      verb: "move",
      args: ["up"],
      rest: "up",
    });
  });

  it("preserves args and rest for multi-word commands", () => {
    const result = parseCommand("talk zofia");
    expect(result.verb).toBe("talk");
    expect(result.args).toEqual(["zofia"]);
    expect(result.rest).toBe("zofia");
  });

  it("splits multiple args on whitespace", () => {
    const result = parseCommand("give henrik short sword");
    expect(result.verb).toBe("give");
    expect(result.args).toEqual(["henrik", "short", "sword"]);
    expect(result.rest).toBe("henrik short sword");
  });

  it("preserves rest as a single string when handlers need free text", () => {
    const result = parseCommand("say hello,  fellow traveler");
    expect(result.verb).toBe("say");
    expect(result.rest).toBe("hello,  fellow traveler");
  });
});

/* ── All ten directions ───────────────────────────────────────────
 *
 * The world design specifies n/s/e/w/ne/nw/se/sw/u/d. Before this, six were
 * implemented and typing `ne` fell through to "Unknown command" — so a room
 * with a northeast exit was unreachable, and the failure looked like a typo
 * rather than a missing feature.
 */
describe("directions — all ten", () => {
  const LONG = [
    "north", "northeast", "east", "southeast",
    "south", "southwest", "west", "northwest",
    "up", "down",
  ];
  const SHORT: Record<string, string> = {
    n: "north", ne: "northeast", e: "east", se: "southeast",
    s: "south", sw: "southwest", w: "west", nw: "northwest",
    u: "up", d: "down",
  };

  it.each(LONG)("routes the bare long form %s to move", (dir) => {
    expect(parseCommand(dir)).toEqual({ verb: "move", args: [dir], rest: dir });
  });

  it.each(Object.entries(SHORT))("expands %s to %s", (short, long) => {
    expect(parseCommand(short)).toEqual({
      verb: "move",
      args: [long],
      rest: long,
    });
  });

  it("covers every declared direction with a short form", () => {
    // Guards against adding a direction and forgetting its alias — the exit
    // would exist and be typable only in full, which nobody would discover.
    expect(new Set(Object.values(SHORT))).toEqual(new Set(DIRECTIONS));
  });

  it("is case-insensitive on the diagonals too", () => {
    expect(parseCommand("NE").args).toEqual(["northeast"]);
    expect(parseCommand("SouthWest")).toEqual({
      verb: "move",
      args: ["southwest"],
      rest: "southwest",
    });
  });
});

describe("sortDirections", () => {
  it("renders exits in compass order, not alphabetical", () => {
    // Alphabetical puts "northeast" between "north" and "northwest", which
    // reads as a word list rather than a set of headings.
    expect(
      sortDirections(["west", "north", "southeast", "northeast"]),
    ).toEqual(["north", "northeast", "southeast", "west"]);
  });

  it("puts vertical last", () => {
    expect(sortDirections(["down", "north", "up", "east"])).toEqual([
      "north",
      "east",
      "up",
      "down",
    ]);
  });

  it("keeps unrecognised names, alphabetically, after the compass", () => {
    // A pack may name an exit `in` or `out`. It must still render rather than
    // vanish from the list.
    expect(sortDirections(["out", "north", "in", "up"])).toEqual([
      "north",
      "up",
      "in",
      "out",
    ]);
  });

  it("does not mutate its input", () => {
    const input = ["west", "north"];
    sortDirections(input);
    expect(input).toEqual(["west", "north"]);
  });
});
