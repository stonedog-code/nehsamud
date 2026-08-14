/**
 * The typecheck gate actually looks at the tests.
 *
 * This guards a regression whose whole character is that it is SILENT. When
 * `typecheck` pointed at the build config, it excluded `**\/*.test.ts` and
 * reported green over suites that could not compile — and a gate checking
 * nothing is indistinguishable from a gate that passes. It cost two rounds
 * of confusing failures (NEH-625, NEH-651), both surfacing much later as
 * jest's "Test suite failed to run" rather than as a type error on the line
 * that caused it.
 *
 * So the thing being asserted is the WIRING: that the script runs the
 * typecheck config, and that the config still sees test files. Reverting
 * either one — the tempting "why are there two tsconfigs?" cleanup — fails
 * here instead of quietly turning the gate off again.
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
      if (pkg.name === "@nehsamud/engine") return dir;
    } catch {
      // Not this directory; keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`@nehsamud/engine root not found from ${process.cwd()}`);
}

const ROOT = packageRoot();

function readJson(relative: string): Record<string, unknown> {
  // Strip line comments: both tsconfigs carry them, and JSON.parse will not.
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

  it("does not exclude test files from the typecheck config", () => {
    const config = readJson("tsconfig.typecheck.json") as {
      exclude?: string[];
      extends?: string;
    };
    expect(config.extends).toBe("./tsconfig.json");
    for (const pattern of config.exclude ?? []) {
      expect(pattern).not.toMatch(/test/);
    }
  });

  it("still keeps test files out of the BUILD config", () => {
    // The other half, and the reason there are two files rather than one:
    // `dist/` must not carry tests. A "simplification" that made the build
    // config match the typecheck one would publish them.
    const config = readJson("tsconfig.json") as { exclude?: string[] };
    expect(config.exclude ?? []).toContain("**/*.test.ts");
  });
});
