/**
 * The schema carries no genre. Asserted, not reviewed.
 *
 * PRD-0002 G2: one engine serves a fantasy MUD and a virtual senior-care
 * centre, and nothing in the schema should have to be explained away in
 * either. That is easy to agree with in review and easy to lose one column
 * at a time — a `race_id` here, an `alignment` there — so it is checked.
 *
 * COMMENTS ARE EXEMPT, DELIBERATELY. The schema's own header explains why
 * there is no `race` table, which it cannot do without writing the word.
 * A guard that banned the word everywhere would make its own rationale
 * unwriteable, and the next person would delete the explanation to get a
 * green test. So comments are stripped and the CODE is checked.
 *
 * The stripper is self-tested below. If it ever over-matched, every
 * assertion here would pass against an empty string while the file count
 * still looked healthy — a green suite checking nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Find the schema by walking up from the working directory.
 *
 * Not `import.meta.url`: this file is compiled by ts-jest under a tsconfig
 * that rejects it (TS1343), and not `__dirname`, which does not exist in an
 * ESM module. Walking up works whether jest was started in this package or
 * at the workspace root, and throws by name if it finds nothing — a test
 * that silently read an empty string would pass every assertion below.
 */
function findSchema(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, "packages/engine-db/prisma/schema.prisma");
    if (existsSync(candidate)) return candidate;
    const local = resolve(dir, "prisma/schema.prisma");
    if (existsSync(local)) return local;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `schema.prisma not found walking up from ${process.cwd()}`,
  );
}

const SCHEMA_PATH = findSchema();

/**
 * Words that name a genre rather than a mechanic.
 *
 * Each one was in the schema before PRD-0002 phase 3, and each has a
 * mechanical replacement:
 *
 *   monster            → hostile
 *   race, class        → character_option_group / character_option
 *   alignment, mob     → tags
 *
 * The rest are here to stop the next fantasy-shaped column arriving.
 */
const GENRE_WORDS = [
  "monster",
  "race",
  "class",
  "alignment",
  "mob",
  "goblin",
  "dungeon",
  "elf",
  "dwarf",
  "orc",
  "wizard",
  "spell",
  "sword",
  "magic",
  "quest",
  "loot",
];

/**
 * Strip Prisma comments — `///` doc comments and `//` line comments.
 *
 * Prisma has no block-comment syntax, so line-wise is complete. Written to
 * take the comment from anywhere on a line, since a trailing `// note` is
 * as much a comment as a whole line of one.
 */
export function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");
const CODE = stripComments(SCHEMA);

describe("the comment stripper itself", () => {
  // Both directions. A stripper that returned "" would make every
  // assertion below pass while checking nothing at all.
  it("removes doc comments and line comments", () => {
    expect(stripComments("/// a race of elves\nmodel A {}")).not.toMatch(
      /race|elves/,
    );
    expect(stripComments("model A {} // a monster")).not.toMatch(/monster/);
  });

  it("keeps the code on a line that also has a comment", () => {
    expect(stripComments("model A {} // note")).toContain("model A {}");
  });

  it("leaves code with no comment completely alone", () => {
    expect(stripComments("model Hostile {\n  id String\n}")).toBe(
      "model Hostile {\n  id String\n}",
    );
  });

  it("leaves enough of the schema to be worth checking", () => {
    // The guard against an over-matching stripper: the real file must still
    // contain its models after stripping.
    expect(CODE).toContain("model MudHostile");
    expect(CODE).toContain("model MudPlayer");
    expect(CODE.length).toBeGreaterThan(1000);
  });
});

describe("schema vocabulary", () => {
  it.each(GENRE_WORDS)("does not use the word %p outside comments", (word) => {
    // Word-ish boundaries so `mob` does not fire on "mobile" and `race`
    // does not fire on "trace" — a guard that cries wolf gets deleted.
    const pattern = new RegExp(`\\b${word}[a-z]*\\b`, "i");
    const offenders = CODE.split("\n")
      .map((line, i) => ({ line: line.trim(), number: i + 1 }))
      .filter(({ line }) => pattern.test(line));
    expect(offenders).toEqual([]);
  });

  it("still names the mechanics that replaced them", () => {
    // The inverse assertion. Without it, deleting the models outright would
    // satisfy every test above.
    expect(CODE).toContain("hostile");
    expect(CODE).toContain("character_option_group");
    expect(CODE).toContain("character_option");
    expect(CODE).toContain("player_option");
    expect(CODE).toContain("tags");
    expect(CODE).toContain("owner_id");
  });

  it("keeps the owner id opaque — no foreign key into another schema", () => {
    // PRD-0002 R9. The FK to `public.user` blocked a standalone deployment
    // twice over, and nothing should quietly reintroduce it.
    expect(CODE).not.toMatch(/references:\s*\[user_id\]/);
    expect(CODE).not.toContain("public.user");
  });

  it("explains itself in the comments the check exempts", () => {
    // The exemption exists so the rationale can be written down. If nobody
    // writes it, the exemption is just a hole.
    expect(SCHEMA).toMatch(/race/i);
    expect(SCHEMA).toMatch(/genre/i);
  });
});
