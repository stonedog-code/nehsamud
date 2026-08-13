import { parseCommand } from "../commands/parser.js";

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
