/**
 * The typecheck gate actually looks at the tests. See the long note in
 * `packages/engine/src/__tests__/typecheck-config.test.ts`.
 *
 * This package had the sharper version of the same bug: its build config
 * narrows `include` to `src/index.ts` alone, so its typecheck covered
 * exactly ONE file — not just the tests, but everything else under `src/`
 * too. Both halves are asserted here, because widening `exclude` without
 * widening `include` would look like a fix and check nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** This package's root, found by walking up to its package.json. */
function packageRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name === "@nehsamud/engine-db") return dir;
    } catch {
      // Not this directory; keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`@nehsamud/engine-db root not found from ${process.cwd()}`);
}

const ROOT = packageRoot();

function readJson(relative: string): Record<string, unknown> {
  const raw = readFileSync(resolve(ROOT, relative), "utf8")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("the typecheck gate covers test files", () => {
  it("runs the typecheck config, not the build config", () => {
    const pkg = readJson("package.json") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.typecheck).toContain("tsconfig.typecheck.json");
  });

  it("widens include to the whole source tree, not one entry file", () => {
    const config = readJson("tsconfig.typecheck.json") as {
      include?: string[];
      exclude?: string[];
      extends?: string;
    };
    expect(config.extends).toBe("./tsconfig.json");
    expect(config.include).toEqual(["src/**/*"]);
    for (const pattern of config.exclude ?? []) {
      expect(pattern).not.toMatch(/test/);
    }
  });

  it("still leaves Prisma's generated client out", () => {
    // Regenerated on every build, and its diagnostics are not ours to fix.
    const config = readJson("tsconfig.typecheck.json") as {
      exclude?: string[];
    };
    expect(config.exclude ?? []).toContain("src/generated");
  });
});
