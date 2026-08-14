/**
 * The script language: text in, a program out.
 *
 * A SMALL PURPOSE-BUILT LANGUAGE, not an embedded interpreter. That is the
 * whole security argument (PRD-0001 R22, R24): a language whose only verbs
 * are the game's own verbs cannot express anything a player could not type
 * by hand, so there is no sandbox to escape from. Embedding a general
 * language and then fencing it off is the harder problem, and the fence is
 * the part that gets it wrong.
 *
 * What it can say, and nothing else:
 *
 *     attack goblin              a command, exactly as typed
 *     repeat 5: attack goblin    a fixed number of times
 *     while hp < 50: rest        while a condition about YOU holds
 *     if hp > 80: attack goblin  once, if it holds
 *     stop                       give up early
 *
 * Blocks are either inline after the colon or indented beneath it:
 *
 *     while hp < 50:
 *       rest
 *       look
 *
 * There are no variables, no assignment, no arithmetic, no function calls
 * and no way to name anything. The only readable state is the player's own,
 * and it is read-only. Adding any of those is how this stops being cheap to
 * reason about, so each would want its own argument.
 */

/** Player state a condition may read. Read-only, and only about yourself. */
export const CONDITION_VARIABLES = [
  "hp",
  "maxhp",
  "level",
  "xp",
] as const;

export type ConditionVariable = (typeof CONDITION_VARIABLES)[number];

export const COMPARISONS = ["<=", ">=", "==", "!=", "<", ">"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export interface Condition {
  variable: ConditionVariable;
  comparison: Comparison;
  value: number;
}

export type Statement =
  | { kind: "command"; text: string; line: number }
  | { kind: "stop"; line: number }
  | { kind: "repeat"; times: number; body: Statement[]; line: number }
  | { kind: "while"; condition: Condition; body: Statement[]; line: number }
  | { kind: "if"; condition: Condition; body: Statement[]; line: number };

export interface Program {
  body: Statement[];
}

/**
 * A parse failure, with the line so the editor can point at it.
 *
 * A script is written by a player, so a failure is ordinary input rather
 * than an exception — but it is thrown rather than returned because a
 * half-parsed program is not a thing any caller should be able to run by
 * forgetting to check.
 */
export class ScriptSyntaxError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ScriptSyntaxError";
    this.line = line;
  }
}

/** How deeply blocks may nest. */
export const MAX_NESTING = 5;

/** How many statements one script may contain, at any depth. */
export const MAX_STATEMENTS = 200;

interface Line {
  indent: number;
  text: string;
  number: number;
}

/** Strip comments and blanks, and measure indentation. */
function readLines(source: string): Line[] {
  const lines: Line[] = [];
  source.split("\n").forEach((raw, index) => {
    // Tabs are an indentation ambiguity nobody needs; a script is a handful
    // of lines and rejecting them costs a player one keystroke.
    if (raw.includes("\t")) {
      throw new ScriptSyntaxError("use spaces, not tabs", index + 1);
    }
    const withoutComment = raw.split("#")[0] ?? "";
    const text = withoutComment.trim();
    if (text === "") return;
    lines.push({
      indent: withoutComment.length - withoutComment.trimStart().length,
      text,
      number: index + 1,
    });
  });
  return lines;
}

function parseCondition(raw: string, line: number): Condition {
  const text = raw.trim();
  // Longest operators first, so `<=` is not read as `<` followed by junk.
  const comparison = COMPARISONS.find((op) => text.includes(op));
  if (!comparison) {
    throw new ScriptSyntaxError(
      `condition needs a comparison (${COMPARISONS.join(", ")}), got "${text}"`,
      line,
    );
  }
  const [left, right] = text.split(comparison);
  const variable = (left ?? "").trim().toLowerCase();
  if (!(CONDITION_VARIABLES as readonly string[]).includes(variable)) {
    throw new ScriptSyntaxError(
      `"${variable}" is not something a script can read. Try: ${CONDITION_VARIABLES.join(", ")}`,
      line,
    );
  }
  const rightText = (right ?? "").trim();
  // `Number("")` is 0, so an empty right-hand side would quietly parse
  // `while hp <:` as `hp < 0` — a condition that is always false, and a
  // loop that silently never runs. Checked explicitly.
  const value = rightText === "" ? Number.NaN : Number(rightText);
  if (!Number.isFinite(value)) {
    throw new ScriptSyntaxError(
      rightText === ""
        ? "condition is missing a number to compare against"
        : `"${rightText}" is not a number`,
      line,
    );
  }
  return { variable: variable as ConditionVariable, comparison, value };
}

/**
 * Parse a script.
 *
 * Throws {@link ScriptSyntaxError} on anything it cannot read, naming the
 * line. Enforces {@link MAX_STATEMENTS} and {@link MAX_NESTING} at parse
 * time rather than at run time: a script too large to be sensible should be
 * refused when it is written, while the player is looking at it, not
 * halfway through a fight.
 */
export function parseScript(source: string): Program {
  const lines = readLines(source);
  let count = 0;

  function block(start: number, indent: number, depth: number): [Statement[], number] {
    if (depth > MAX_NESTING) {
      throw new ScriptSyntaxError(
        `nested too deeply (limit ${MAX_NESTING})`,
        lines[start]?.number ?? 0,
      );
    }
    const body: Statement[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new ScriptSyntaxError("unexpected indent", line.number);
      }
      const [statement, next] = statementAt(i, depth);
      body.push(statement);
      i = next;
    }
    return [body, i];
  }

  function statementAt(index: number, depth: number): [Statement, number] {
    const line = lines[index]!;
    count += 1;
    if (count > MAX_STATEMENTS) {
      throw new ScriptSyntaxError(
        `script is too long (limit ${MAX_STATEMENTS} statements)`,
        line.number,
      );
    }

    const colon = line.text.indexOf(":");
    const head = (colon === -1 ? line.text : line.text.slice(0, colon)).trim();
    const inline = colon === -1 ? "" : line.text.slice(colon + 1).trim();
    const [keyword, ...rest] = head.split(/\s+/);
    const word = (keyword ?? "").toLowerCase();

    /* ── Blocks ─────────────────────────────────────────────────── */
    if (word === "repeat" || word === "while" || word === "if") {
      if (colon === -1) {
        throw new ScriptSyntaxError(`\`${word}\` needs a colon`, line.number);
      }
      // An inline body is one statement on THIS line, so the next statement
      // is simply the next line. An indented body consumes lines and says
      // where it stopped.
      const [body, next] = inline
        ? ([inlineBody(inline, line.number), index + 1] as [Statement[], number])
        : indentedBody(index, line, depth);

      if (word === "repeat") {
        const times = Number(rest.join(" ").trim());
        if (!Number.isInteger(times) || times < 0) {
          throw new ScriptSyntaxError(
            `repeat needs a whole number of times, got "${rest.join(" ")}"`,
            line.number,
          );
        }
        return [{ kind: "repeat", times, body, line: line.number }, next];
      }
      const condition = parseCondition(rest.join(" "), line.number);
      return [{ kind: word, condition, body, line: line.number }, next];
    }

    /* ── Simple statements ──────────────────────────────────────── */
    if (colon !== -1) {
      throw new ScriptSyntaxError(
        `only \`repeat\`, \`while\` and \`if\` take a colon`,
        line.number,
      );
    }
    if (word === "stop") {
      return [{ kind: "stop", line: line.number }, index + 1];
    }
    return [
      { kind: "command", text: line.text, line: line.number },
      index + 1,
    ];
  }

  function inlineBody(text: string, lineNumber: number): Statement[] {
    if (text.includes(":")) {
      throw new ScriptSyntaxError(
        "an inline body cannot open another block — put it on its own lines",
        lineNumber,
      );
    }
    count += 1;
    if (count > MAX_STATEMENTS) {
      throw new ScriptSyntaxError(
        `script is too long (limit ${MAX_STATEMENTS} statements)`,
        lineNumber,
      );
    }
    const statement: Statement =
      text.toLowerCase() === "stop"
        ? { kind: "stop", line: lineNumber }
        : { kind: "command", text, line: lineNumber };
    return [statement];
  }

  function indentedBody(
    index: number,
    line: Line,
    depth: number,
  ): [Statement[], number] {
    const next = lines[index + 1];
    if (!next || next.indent <= line.indent) {
      throw new ScriptSyntaxError(
        "this block has no body — indent the lines beneath it",
        line.number,
      );
    }
    return block(index + 1, next.indent, depth + 1);
  }

  const body: Statement[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.indent !== 0) {
      throw new ScriptSyntaxError("unexpected indent", lines[i]!.number);
    }
    const [statement, next] = statementAt(i, 0);
    body.push(statement);
    i = next;
  }
  return { body };
}
