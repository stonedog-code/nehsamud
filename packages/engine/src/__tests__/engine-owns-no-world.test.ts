/**
 * The engine names no room in any pack. Asserted, not reviewed.
 *
 * PRD-0002 R3 — "`TOWNSMEE_TOWNSQUARE` must not appear in engine code" —
 * and success criterion 2, which asks for this to be *checked by a test,
 * not by review*. The requirement is easy to agree with and easy to lose
 * one file at a time: the spawn key had accumulated THREE independent
 * copies (`ws-server.ts`, `commands/handlers/look.ts`, `seed/seed.ts`) with
 * no mechanism keeping them in step, and every one of them arrived through
 * a reviewed change.
 *
 * WHAT THIS IS AND IS NOT. This checks that the engine's *mechanics* name
 * no pack's content. It is deliberately narrower than "no genre word
 * appears in engine source", because that is not true yet and a guard that
 * fails on arrival gets weakened until it passes. The remaining genre
 * vocabulary is player-facing PROSE — `look.ts` still renders "Monsters
 * here:", `talk.ts` still opens its AI prompt with "a fantasy MUD" — and
 * moving prose into a pack-supplied message catalog is phase 4 (R10-R12),
 * not this change. The schema's half of criterion 2 is already enforced by
 * `packages/engine-db/src/__tests__/schema-vocabulary.test.ts`; this is the
 * source half, at the scope that is honestly true today.
 *
 * COMMENTS ARE EXEMPT, DELIBERATELY, and for the reason the schema guard
 * gives: `attack.ts` explains the respawn contract, and it cannot do that
 * without naming the room. A guard that banned the word everywhere would
 * make its own rationale unwriteable, and the next person would delete the
 * explanation to get a green test.
 *
 * The stripper is self-tested below, in both directions. If it ever
 * over-matched, every assertion here would pass against empty strings while
 * the file count still looked healthy — a green suite checking nothing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Find the engine's `src` by walking up from the working directory.
 *
 * Not `import.meta.url` (ts-jest compiles this under a tsconfig that
 * rejects it, TS1343) and not `__dirname` (absent in ESM). Throws by name
 * if it finds nothing — the failure this whole file exists to prevent is a
 * check that silently examined no files.
 */
function findEngineSrc(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    for (const candidate of [
      resolve(dir, "packages/engine/src"),
      resolve(dir, "src"),
    ]) {
      try {
        if (statSync(join(candidate, "ws-server.ts")).isFile()) return candidate;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`engine src not found walking up from ${process.cwd()}`);
}

const SRC = findEngineSrc();

/**
 * Directories that ARE content, or that legitimately name it.
 *
 * `content/` holds the packs themselves and `seed/fixtures/` holds their
 * data — a pack that could not name its own rooms would be no pack. Tests
 * build worlds out of pack content by necessity. `index.ts` is the public
 * barrel and re-exports the bundled pack by name, which is the export a
 * host imports.
 */
const EXEMPT_DIRS = ["content", "__tests__", "__integration__"];
const EXEMPT_PATHS = [join("seed", "fixtures")];
const EXEMPT_FILES = ["index.ts"];

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.includes(entry.name)) continue;
      collect(full, acc);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (EXEMPT_FILES.includes(entry.name) && dirname(full) === SRC) continue;
    if (EXEMPT_PATHS.some((p) => full.includes(p))) continue;
    acc.push(full);
  }
  return acc;
}

const FILES = collect(SRC).sort();

/**
 * Strip TypeScript comments — `//` to end of line, and `/* … *\/` blocks.
 *
 * Written to take a trailing comment from anywhere on a line, since
 * `foo(); // TOWNSMEE_X` is as much a comment as a whole line of one. Not a
 * parser: it does not understand a comment marker inside a string literal.
 * That errs toward stripping MORE than it should, which for this guard
 * would only ever cause a false pass — so the assertions below check the
 * real files still have their code in them after stripping.
 */
export function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

describe("the comment stripper itself", () => {
  it("removes line comments and block comments", () => {
    expect(stripComments("const a = 1; // TOWNSMEE_TOWNSQUARE")).not.toMatch(
      /TOWNSMEE/,
    );
    expect(stripComments("/**\n * TOWNSMEE_TOWNSQUARE\n */\nconst a = 1;"))
      .not.toMatch(/TOWNSMEE/);
  });

  it("keeps the code on a line that also has a comment", () => {
    expect(stripComments("const a = 1; // note")).toContain("const a = 1;");
  });

  it("leaves code with no comment completely alone", () => {
    expect(stripComments("const a = 1;\nconst b = 2;")).toBe(
      "const a = 1;\nconst b = 2;",
    );
  });
});

describe("the engine owns no world", () => {
  it("examines a real set of files", () => {
    // The input-set size, printed. "0 offenders over 0 files" and "0 over
    // 45" are the same output and different facts, and the count is the
    // only signal that the scope has not silently collapsed.
    console.log(
      `[engine-owns-no-world] scanned ${FILES.length} engine source file(s) under ${SRC}`,
    );
    expect(FILES.length).toBeGreaterThanOrEqual(35);
    // The files the requirement is actually about must be in the set. A
    // scope that quietly stopped covering ws-server.ts would pass forever.
    for (const required of [
      "ws-server.ts",
      join("commands", "handlers", "look.ts"),
      join("seed", "seed.ts"),
      "server.ts",
    ]) {
      expect(FILES.some((f) => f.endsWith(required))).toBe(true);
    }
  });

  it("keeps enough of each file after stripping to be worth checking", () => {
    // The guard against an over-matching stripper. If it returned "", every
    // assertion below would pass while checking nothing at all.
    const wsServer = FILES.find((f) => f.endsWith("ws-server.ts"))!;
    const code = stripComments(readFileSync(wsServer, "utf8"));
    expect(code).toContain("export class MudWsServer");
    expect(code).toContain("spawnRoomEnumKey");
    expect(code.length).toBeGreaterThan(2000);
  });

  it("names no pack room key outside comments", () => {
    // Room enumKeys are SCREAMING_SNAKE by convention across every pack, so
    // this catches a second world's keys as readily as Townsmee's — the
    // point is that the engine hardcodes NO world's content, not that it
    // stops hardcoding one particular one.
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = stripComments(readFileSync(file, "utf8"));
      code.split("\n").forEach((line, i) => {
        if (/\bTOWNSMEE[A-Z_]*\b/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still reaches its spawn through the world, which is the replacement", () => {
    // The inverse assertion. Without it, deleting the respawn branch
    // outright would satisfy the check above.
    const look = FILES.find((f) => f.endsWith(join("handlers", "look.ts")))!;
    const code = stripComments(readFileSync(look, "utf8"));
    expect(code).toContain("world.spawnRoomEnumKey");

    const seed = FILES.find((f) => f.endsWith(join("seed", "seed.ts")))!;
    expect(stripComments(readFileSync(seed, "utf8"))).toContain(
      "pack.spawnRoomEnumKey",
    );
  });

  it("explains itself in the comments the check exempts", () => {
    // The exemption exists so the rationale can be written down. If nobody
    // writes it, the exemption is just a hole.
    const attack = FILES.find((f) => f.endsWith(join("handlers", "attack.ts")))!;
    expect(readFileSync(attack, "utf8")).toMatch(/TOWNSMEE/);
  });
});
