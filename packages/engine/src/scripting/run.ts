/**
 * Running a script, one command at a time.
 *
 * A STEP MACHINE, NOT A LOOP THAT RETURNS A LIST. This is the design
 * decision the whole module rests on, and the obvious alternative is wrong:
 * a runner that walks the program collecting commands would evaluate
 * `while hp < 50: rest` against the hp it started with, so it would either
 * emit nothing or emit `rest` forever. The condition has to be re-read after
 * every command, which means the host has to dispatch each one and hand the
 * new state back.
 *
 * So the host owns the loop:
 *
 *     const runner = new ScriptRunner(program, limits);
 *     for (;;) {
 *       const step = runner.next(currentState());
 *       if (step.done) break;
 *       await dispatch(step.command);
 *     }
 *
 * That shape is also what makes this decision-independent. PRD-0001 OQ1 —
 * whether scripts run client-side or server-side — is still open, and this
 * module does not care: a browser can drive that loop over a WebSocket and
 * the engine can drive it in-process. Neither has to change the language.
 *
 * IT ALSO CANNOT RUN AWAY. The budget lives here rather than in whichever
 * host happens to be driving, so a host that forgets to impose one still
 * gets the caps (PRD-0001 R21). `while hp < 50: look` is an infinite loop —
 * `look` never changes hp — and it is stopped by the instruction budget
 * rather than by anybody noticing.
 */

import type { Condition, Program, Statement } from "./parse.js";

/** Everything a condition may read. Supplied by the host, never mutated. */
export interface ScriptState {
  hp: number;
  maxhp: number;
  level: number;
  xp: number;
}

export interface ScriptLimits {
  /**
   * Most commands one run may issue.
   *
   * The real defence. Wall-clock alone cannot stop a tight loop on a fast
   * machine from issuing thousands of commands in its allowance.
   */
  maxCommands: number;
  /**
   * Most steps the interpreter may take, including ones that issue nothing.
   *
   * Separate from `maxCommands` because a loop can spin without emitting —
   * `while hp > 0:` around an `if` that never fires does no work and would
   * otherwise never hit a command limit.
   */
  maxSteps: number;
  /** Wall-clock cap for the whole run, in milliseconds. */
  maxDurationMs: number;
}

export const DEFAULT_LIMITS: ScriptLimits = {
  maxCommands: 200,
  maxSteps: 10_000,
  maxDurationMs: 60_000,
};

export type StopReason =
  /** The program ran to the end. */
  | "completed"
  /** The script said `stop`. */
  | "stopped"
  /** Too many commands issued. */
  | "command-budget"
  /** Too many interpreter steps. */
  | "step-budget"
  /** Wall-clock cap reached. */
  | "timeout";

export type Step =
  | { done: false; command: string }
  | { done: true; reason: StopReason; commands: number; steps: number };

/** What a player is told when a run ends. Plain, and never a stack trace. */
export const STOP_MESSAGES: Readonly<Record<StopReason, string>> = {
  completed: "Script finished.",
  stopped: "Script stopped.",
  "command-budget":
    "Script stopped: it tried to run too many commands. Scripts are capped so one cannot take over the world.",
  "step-budget":
    "Script stopped: it looped without getting anywhere. Check that something in the loop changes what the condition tests.",
  timeout: "Script stopped: it ran for too long.",
};

/** One frame of the interpreter's own stack. */
interface Frame {
  body: Statement[];
  index: number;
  /** For `repeat`: how many passes are left after the current one. */
  remaining?: number;
  /** For `while`: re-tested each time the body completes. */
  condition?: Condition;
}

function test(condition: Condition, state: ScriptState): boolean {
  const left = state[condition.variable];
  switch (condition.comparison) {
    case "<":
      return left < condition.value;
    case "<=":
      return left <= condition.value;
    case ">":
      return left > condition.value;
    case ">=":
      return left >= condition.value;
    case "==":
      return left === condition.value;
    case "!=":
      return left !== condition.value;
  }
}

export class ScriptRunner {
  private readonly limits: ScriptLimits;
  private readonly now: () => number;
  private stack: Frame[];
  private commands = 0;
  private steps = 0;
  private startedAt: number | undefined;
  private finished: StopReason | undefined;

  /**
   * @param now Injected clock, so the wall-clock cap is testable without
   * waiting a minute. Production passes nothing.
   */
  constructor(
    program: Program,
    limits: ScriptLimits = DEFAULT_LIMITS,
    now: () => number = Date.now,
  ) {
    this.limits = limits;
    this.now = now;
    this.stack = [{ body: program.body, index: 0 }];
  }

  /** Commands issued so far. */
  get issued(): number {
    return this.commands;
  }

  /**
   * The next command to run, given the world as it is NOW.
   *
   * State is passed in on every call rather than captured once, because
   * that is the entire point: a loop that waits for hp to recover has to see
   * the hp that resting produced.
   */
  next(state: ScriptState): Step {
    if (this.finished) return this.end(this.finished);
    this.startedAt ??= this.now();

    for (;;) {
      // Checked before every step, so a run cannot overshoot by the length
      // of one iteration.
      if (this.now() - this.startedAt >= this.limits.maxDurationMs) {
        return this.end("timeout");
      }
      this.steps += 1;
      if (this.steps > this.limits.maxSteps) {
        return this.end("step-budget");
      }

      const frame = this.stack[this.stack.length - 1];
      if (!frame) return this.end("completed");

      if (frame.index >= frame.body.length) {
        // The body ran out. A `repeat` with passes left or a `while` whose
        // condition still holds goes round again; anything else pops.
        if (frame.remaining !== undefined && frame.remaining > 0) {
          frame.remaining -= 1;
          frame.index = 0;
          continue;
        }
        if (frame.condition && test(frame.condition, state)) {
          frame.index = 0;
          continue;
        }
        this.stack.pop();
        continue;
      }

      const statement = frame.body[frame.index]!;
      frame.index += 1;

      switch (statement.kind) {
        case "stop":
          return this.end("stopped");

        case "command": {
          // Checked BEFORE counting. Counting first would report one more
          // command issued than the host was ever handed — the budget would
          // read as off-by-one to anyone auditing it afterwards.
          if (this.commands + 1 > this.limits.maxCommands) {
            return this.end("command-budget");
          }
          this.commands += 1;
          return { done: false, command: statement.text };
        }

        case "if":
          if (test(statement.condition, state)) {
            this.stack.push({ body: statement.body, index: 0 });
          }
          continue;

        case "while":
          if (test(statement.condition, state)) {
            this.stack.push({
              body: statement.body,
              index: 0,
              condition: statement.condition,
            });
          }
          continue;

        case "repeat":
          if (statement.times > 0) {
            this.stack.push({
              body: statement.body,
              index: 0,
              remaining: statement.times - 1,
            });
          }
          continue;
      }
    }
  }

  private end(reason: StopReason): Step {
    this.finished = reason;
    return { done: true, reason, commands: this.commands, steps: this.steps };
  }
}
