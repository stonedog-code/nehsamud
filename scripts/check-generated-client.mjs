#!/usr/bin/env node
/**
 * Refuse to run when the generated Prisma client is ABSENT or OLDER than the
 * schema it was generated from (NEH-1315).
 *
 * ## Why this exists
 *
 * `packages/engine-db` generates its client into `generated/client`, which is
 * gitignored. Two states then look almost identical and neither names itself:
 *
 * | state | what you see |
 * | -- | -- |
 * | client ABSENT (a fresh checkout) | `Cannot find module '@nehsamud/engine-db'` in 46 places |
 * | client STALE (schema edited since) | `TS2339: Property 'mudHostile' does not exist on type 'PrismaClient'` |
 *
 * The second is the nastier one, because `model MudHostile` is right there in
 * `schema.prisma` — the error names a symbol you can see in the source, so it
 * reads as a broken import or a broken branch rather than as a generated
 * artifact lagging its input. That misdiagnosis is the whole cost.
 *
 * ## What it does NOT do
 *
 * It does not regenerate. The test and typecheck lanes regenerate for you (root
 * `pretest:unit` / `pretypecheck` → `build:deps`); this guard is for the lanes
 * that legitimately do not build first, above all `npm run dev`, where a stale
 * client produces a running app that is subtly wrong about its own schema.
 *
 * ## Both directions
 *
 * `--self-check` plants each failure it exists to catch, in a throwaway
 * directory, and asserts it is caught — then asserts a healthy tree passes.
 * A guard only ever observed passing has not been tested, it has been run.
 */
import { statSync, existsSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = "npm run build:deps   (or: npm run prisma:generate)";

/**
 * @param {string} root a directory holding packages/engine-db
 * @returns {{ok: boolean, reason: string, lines: string[]}}
 */
export function checkGeneratedClient(root) {
  const schema = join(root, "packages/engine-db/prisma/schema.prisma");
  const client = join(root, "packages/engine-db/generated/client");
  const lines = [];

  if (!existsSync(schema)) {
    return {
      ok: false,
      reason: "no-schema",
      lines: [`  schema  ${schema}  ABSENT`],
    };
  }
  const schemaAt = statSync(schema).mtime;
  lines.push(`  schema           ${schema}`);
  lines.push(`  schema mtime     ${schemaAt.toISOString()}`);

  if (!existsSync(client)) {
    lines.push(`  generated client ${client}  ABSENT`);
    return { ok: false, reason: "absent", lines };
  }
  const clientAt = statSync(client).mtime;
  lines.push(`  generated client ${client}`);
  lines.push(`  client mtime     ${clientAt.toISOString()}`);

  // Strictly older. Equal timestamps are accepted: a filesystem with
  // second granularity can report a generate that ran immediately after an
  // edit as equal, and refusing that would be a guard nobody could satisfy.
  if (clientAt < schemaAt) {
    return { ok: false, reason: "stale", lines };
  }
  return { ok: true, reason: "fresh", lines };
}

const MESSAGES = {
  "no-schema": "packages/engine-db/prisma/schema.prisma is missing — this is not a nehsamud checkout.",
  absent: "The generated Prisma client does NOT EXIST. Nothing that imports @nehsamud/engine-db can compile.",
  stale: "The generated Prisma client is OLDER than the schema it came from, so it is missing whatever the schema gained since.",
};

function report(result) {
  // The input set, always — a pass over nothing and a real pass print the same
  // word otherwise.
  console.log("Generated Prisma client freshness:");
  for (const l of result.lines) console.log(l);
  if (result.ok) {
    console.log("  OK — the client is at least as new as its schema.");
    return 0;
  }
  console.error("");
  console.error(`REFUSED: ${MESSAGES[result.reason]}`);
  console.error(`Fix it with: ${FIX}`);
  return 1;
}

// ── self-check ───────────────────────────────────────────────────────────────

function selfCheck() {
  const tmp = join(REPO_ROOT, `.self-check-${process.pid}`);
  const dir = join(tmp, "packages/engine-db/prisma");
  const gen = join(tmp, "packages/engine-db/generated/client");
  let pass = 0;
  let fail = 0;
  const ok = (name) => { console.log(`  ok   ${name}`); pass++; };
  const bad = (name, detail) => { console.log(`  FAIL ${name} — ${detail}`); fail++; };

  try {
    mkdirSync(dir, { recursive: true });
    const schema = join(dir, "schema.prisma");
    writeFileSync(schema, "model MudHostile {}\n");

    // 1. absent
    let r = checkGeneratedClient(tmp);
    r.reason === "absent" && !r.ok ? ok("an ABSENT client is refused") : bad("an ABSENT client is refused", r.reason);

    // 2. stale — client mtime deliberately one hour behind the schema
    mkdirSync(gen, { recursive: true });
    const past = new Date(statSync(schema).mtime.getTime() - 3600_000);
    utimesSync(gen, past, past);
    r = checkGeneratedClient(tmp);
    r.reason === "stale" && !r.ok ? ok("a STALE client is refused") : bad("a STALE client is refused", r.reason);
    // The plant must be visible to the guard, not merely present on disk:
    r.lines.some((l) => l.includes(past.toISOString()))
      ? ok("the refusal names the stale mtime the plant set")
      : bad("the refusal names the stale mtime the plant set", r.lines.join(" | "));

    // 3. fresh
    const future = new Date(statSync(schema).mtime.getTime() + 3600_000);
    utimesSync(gen, future, future);
    r = checkGeneratedClient(tmp);
    r.ok && r.reason === "fresh" ? ok("a FRESH client passes") : bad("a FRESH client passes", r.reason);

    // 4. equal mtimes are accepted, deliberately
    const same = statSync(schema).mtime;
    utimesSync(gen, same, same);
    r = checkGeneratedClient(tmp);
    r.ok ? ok("EQUAL mtimes are accepted") : bad("EQUAL mtimes are accepted", r.reason);

    // 5. not a checkout at all
    r = checkGeneratedClient(join(tmp, "nowhere"));
    r.reason === "no-schema" ? ok("a directory with no schema is refused, by name") : bad("a directory with no schema is refused, by name", r.reason);

    // 6. the control: the REAL repo, whatever state it is in, is described
    //    without throwing and names both paths.
    r = checkGeneratedClient(REPO_ROOT);
    r.lines.length >= 1 && r.lines.some((l) => l.includes("schema"))
      ? ok(`the real checkout is described (verdict: ${r.reason})`)
      : bad("the real checkout is described", JSON.stringify(r));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("");
  console.log(`${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[2] === "--self-check") {
  process.exit(selfCheck());
} else {
  process.exit(report(checkGeneratedClient(REPO_ROOT)));
}
