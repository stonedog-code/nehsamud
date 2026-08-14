/**
 * The player scripting language (PRD-0001 R20–R24).
 *
 * Two halves, both host-agnostic: {@link parseScript} turns text into a
 * program, and {@link ScriptRunner} walks it one command at a time against
 * live player state.
 *
 * WHERE IT RUNS IS STILL OPEN (PRD-0001 OQ1 — client-side macros or
 * server-side execution). Nothing here decides that, deliberately: the
 * runner hands the host one command and waits to be given the resulting
 * state, so a browser driving it over a WebSocket and the engine driving it
 * in-process are the same loop. The language does not change either way.
 *
 * Two constraints are settled regardless, and live here rather than in
 * whichever host is driving:
 *
 *   R21/R22  the budget is inside the runner, so a host that forgets to
 *            impose one still gets it;
 *   R24      the language has no verbs of its own — a statement IS a line a
 *            player could type — so there is nothing for it to do that
 *            typing could not.
 *
 * R23 (unavailable in Exploration) is a gate for the host, which already
 * has `capabilities.scripting` to read.
 */

export {
  parseScript,
  ScriptSyntaxError,
  COMPARISONS,
  CONDITION_VARIABLES,
  MAX_NESTING,
  MAX_STATEMENTS,
  type Comparison,
  type Condition,
  type ConditionVariable,
  type Program,
  type Statement,
} from "./parse.js";

export {
  ScriptRunner,
  DEFAULT_LIMITS,
  STOP_MESSAGES,
  type ScriptLimits,
  type ScriptState,
  type Step,
  type StopReason,
} from "./run.js";
