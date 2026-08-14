/**
 * The integration tier — a REAL Postgres, a REAL server, a REAL socket.
 *
 * Separate from `jest.config.cjs` because the two tiers answer different
 * questions and have different requirements. The unit tier runs anywhere,
 * in milliseconds, against fakes. This one refuses to run without a
 * database, boots a WebSocket server per suite, and asserts on rows.
 *
 * Keeping them in one config would mean either the unit tier acquires a
 * database dependency (and stops being runnable on a fresh clone) or the
 * integration tier gets skipped when the database is absent — and a tier
 * that skips itself silently is the one nobody notices has stopped
 * running. `setup.ts` fails loudly instead.
 *
 * `testMatch` is scoped to `__integration__/` rather than a filename
 * suffix, so a file cannot land in the wrong tier by being misnamed.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@nehsamud/engine-db$": "<rootDir>/../engine-db/dist/index.js",
  },
  testMatch: ["<rootDir>/src/__integration__/**/*.test.ts"],
  // Serial. Every suite writes to the same database, and two suites
  // creating characters concurrently would fight over the unique name
  // index and over what "the rows for this owner" means.
  maxWorkers: 1,
  // Booting a server and migrating a world is not a 5-second job, and a
  // timeout that fires on a slow CI runner reads as a broken test.
  testTimeout: 60_000,
  setupFilesAfterEnv: ["<rootDir>/src/__integration__/setup.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "NodeNext",
          esModuleInterop: true,
          strict: true,
        },
      },
    ],
  },
};
