/**
 * The script language, and the caps that make it safe to offer.
 *
 * Two groups matter more than the rest. The RUNAWAY tests, because a script
 * is written by a player and "it loops forever" is the ordinary case rather
 * than the attack; and the STEP-MACHINE tests, because the obvious wrong
 * implementation — walk the program, collect the commands — passes every
 * parser test in this file and then either emits nothing for
 * `while hp < 50: rest` or emits it forever.
 */

import {
  DEFAULT_LIMITS,
  MAX_NESTING,
  MAX_STATEMENTS,
  ScriptRunner,
  ScriptSyntaxError,
  parseScript,
  type ScriptState,
} from "../scripting/index.js";

const HEALTHY: ScriptState = { hp: 30, maxhp: 30, level: 1, xp: 0 };

/**
 * Drive a script to completion the way a host would, with state that can
 * change between commands.
 */
function drive(
  source: string,
  opts: {
    state?: ScriptState;
    /** Applied after each command, as dispatching it would. */
    after?: (state: ScriptState, command: string) => ScriptState;
    limits?: Partial<typeof DEFAULT_LIMITS>;
    clock?: () => number;
  } = {},
) {
  const runner = new ScriptRunner(
    parseScript(source),
    { ...DEFAULT_LIMITS, ...opts.limits },
    opts.clock,
  );
  let state = opts.state ?? HEALTHY;
  const commands: string[] = [];
  for (;;) {
    const step = runner.next(state);
    if (step.done) return { commands, reason: step.reason, steps: step.steps };
    commands.push(step.command);
    if (opts.after) state = opts.after(state, step.command);
  }
}

describe("parsing", () => {
  it("reads a flat list of commands", () => {
    expect(drive("look\nattack goblin").commands).toEqual([
      "look",
      "attack goblin",
    ]);
  });

  it("ignores blank lines and comments", () => {
    const source = ["# clear the room", "", "attack goblin  # the small one", ""].join("\n");
    expect(drive(source).commands).toEqual(["attack goblin"]);
  });

  it("takes a body inline or indented, and means the same thing", () => {
    const inline = drive("repeat 2: attack goblin").commands;
    const indented = drive("repeat 2:\n  attack goblin").commands;
    expect(inline).toEqual(["attack goblin", "attack goblin"]);
    expect(indented).toEqual(inline);
  });

  it("names the line when it cannot read something", () => {
    // A script is written by a player, so a failure is ordinary input. It
    // has to say WHERE, or the only way to find it is bisection.
    expect(() => parseScript("look\nwhile hp <: rest")).toThrow(
      ScriptSyntaxError,
    );
    try {
      parseScript("look\nwhile hp <: rest");
    } catch (err) {
      expect((err as ScriptSyntaxError).line).toBe(2);
    }
  });

  it("refuses to read anything but the player's own state", () => {
    // No world state, no other players. The language cannot express
    // "attack whoever is weakest", and that is deliberate.
    expect(() => parseScript("while goblin.hp < 5: attack goblin")).toThrow(
      /not something a script can read/,
    );
  });

  it("refuses a block with no body", () => {
    expect(() => parseScript("while hp < 50:")).toThrow(/no body/);
  });

  it("refuses tabs rather than guessing what they meant", () => {
    expect(() => parseScript("repeat 2:\n\tlook")).toThrow(/spaces, not tabs/);
  });

  it("refuses an inline body that opens another block", () => {
    // `while hp < 50: if hp > 10: rest` has no reading a player would
    // predict, so it is refused rather than given one.
    expect(() => parseScript("while hp < 50: if hp > 10: rest")).toThrow(
      /own lines/,
    );
  });

  it("refuses a script that is too long, or nested too deep", () => {
    // At PARSE time, while the player is looking at it — not halfway
    // through a fight.
    const long = Array.from({ length: MAX_STATEMENTS + 1 }, () => "look").join("\n");
    expect(() => parseScript(long)).toThrow(/too long/);

    let deep = "";
    for (let i = 0; i <= MAX_NESTING + 1; i += 1) {
      deep += `${"  ".repeat(i)}repeat 1:\n`;
    }
    deep += `${"  ".repeat(MAX_NESTING + 2)}look`;
    expect(() => parseScript(deep)).toThrow(/too deeply/);
  });
});

describe("control flow", () => {
  it("repeats a fixed number of times", () => {
    expect(drive("repeat 3: attack goblin").commands).toHaveLength(3);
  });

  it("treats `repeat 0` as doing nothing at all", () => {
    expect(drive("repeat 0: attack goblin").commands).toEqual([]);
  });

  it("runs an `if` only when it holds", () => {
    expect(drive("if hp < 10: rest", { state: HEALTHY }).commands).toEqual([]);
    expect(
      drive("if hp < 10: rest", { state: { ...HEALTHY, hp: 5 } }).commands,
    ).toEqual(["rest"]);
  });

  it("nests, and unwinds in the right order", () => {
    const source = ["repeat 2:", "  look", "  repeat 2:", "    attack goblin"].join("\n");
    expect(drive(source).commands).toEqual([
      "look",
      "attack goblin",
      "attack goblin",
      "look",
      "attack goblin",
      "attack goblin",
    ]);
  });

  it("stops the whole script at `stop`, from any depth", () => {
    const source = ["repeat 5:", "  look", "  stop", "  attack goblin"].join("\n");
    const run = drive(source);
    expect(run.commands).toEqual(["look"]);
    expect(run.reason).toBe("stopped");
  });
});

describe("conditions are re-read between commands", () => {
  it("loops until the world changes, not until the program says so", () => {
    // THE test for the step machine. A runner that evaluated the condition
    // once would emit `rest` forever or not at all; this one has to see the
    // hp that resting produced.
    const run = drive("while hp < 30: rest", {
      state: { ...HEALTHY, hp: 26 },
      after: (state) => ({ ...state, hp: state.hp + 1 }),
    });
    expect(run.commands).toEqual(["rest", "rest", "rest", "rest"]);
    expect(run.reason).toBe("completed");
  });

  it("does not enter a loop whose condition is already false", () => {
    expect(drive("while hp < 10: rest").commands).toEqual([]);
  });

  it("re-tests an `if` inside a loop each time round", () => {
    const source = ["repeat 3:", "  if hp < 30: rest", "  attack goblin"].join("\n");
    const run = drive(source, {
      state: { ...HEALTHY, hp: 28 },
      after: (state, command) =>
        command === "rest" ? { ...state, hp: 30 } : state,
    });
    // Rests on the first pass only, because the second and third see full hp.
    expect(run.commands).toEqual([
      "rest",
      "attack goblin",
      "attack goblin",
      "attack goblin",
    ]);
  });
});

describe("a script cannot run away", () => {
  it("stops a loop that never changes what it tests", () => {
    // `look` does not move hp, so this is an infinite loop — and it is the
    // ORDINARY mistake, not an attack. It has to end by itself.
    const run = drive("while hp < 50: look", { limits: { maxCommands: 20 } });
    expect(run.reason).toBe("command-budget");
    expect(run.commands).toHaveLength(20);
  });

  it("stops a loop that spins without issuing anything", () => {
    // No command is ever emitted, so a command budget alone would never
    // fire. This is why there are two counters.
    const source = ["while hp > 0:", "  if hp > 999: look"].join("\n");
    const run = drive(source, { limits: { maxSteps: 500 } });
    expect(run.reason).toBe("step-budget");
    expect(run.commands).toEqual([]);
  });

  it("stops when the wall clock runs out", () => {
    // Injected, so this asserts the cap without waiting a minute for it.
    let now = 0;
    const run = drive("while hp < 50: look", {
      limits: { maxDurationMs: 100 },
      clock: () => {
        now += 30;
        return now;
      },
    });
    expect(run.reason).toBe("timeout");
  });

  it("stays stopped once it has stopped", () => {
    // A host that keeps calling `next` after a budget was hit must not get
    // a script that quietly resumes.
    const runner = new ScriptRunner(parseScript("repeat 3: look"), {
      ...DEFAULT_LIMITS,
      maxCommands: 1,
    });
    expect(runner.next(HEALTHY).done).toBe(false);
    const stopped = runner.next(HEALTHY);
    expect(stopped.done).toBe(true);
    expect(runner.next(HEALTHY)).toMatchObject({ done: true });
    expect(runner.issued).toBe(1);
  });

  it("caps by default, without the host asking", () => {
    // The budget lives in the runner precisely so a host that forgets to
    // pass limits still gets them.
    const runner = new ScriptRunner(parseScript("while hp < 50: look"));
    let count = 0;
    for (;;) {
      const step = runner.next(HEALTHY);
      if (step.done) break;
      count += 1;
      if (count > DEFAULT_LIMITS.maxCommands + 5) throw new Error("no cap");
    }
    expect(count).toBe(DEFAULT_LIMITS.maxCommands);
  });
});

describe("what the language cannot express", () => {
  it("has no verbs of its own — a statement is a line you could type", () => {
    // PRD-0001 R24. Anything that is not a keyword is passed through
    // verbatim for the host to dispatch, so the language cannot reach
    // anything the command parser does not already offer.
    const run = drive("whisper aelric hello there");
    expect(run.commands).toEqual(["whisper aelric hello there"]);
  });

  it("cannot assign, compute, or name anything", () => {
    // These are commands, not syntax errors — which is the point. They go
    // to the dispatcher, which does not know them, and the player is told
    // so by the game rather than by the language.
    const run = drive("x = 5");
    expect(run.commands).toEqual(["x = 5"]);
  });
});
