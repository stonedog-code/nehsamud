/**
 * db.ts smoke tests. Doesn't hit a real Postgres — verifies the
 * factory wiring + the error paths that callers actually rely on
 * during boot.
 *
 * `@nehsamud/engine-db` is mocked so jest doesn't have to parse the
 * workspace package's ESM dist build. Real Postgres exercise lives
 * in the Phase 9 integration suite.
 */

jest.mock("@nehsamud/engine-db", () => ({
  createMudPrismaClient: jest.fn(() => ({
    $connect: jest.fn(async () => undefined),
    $disconnect: jest.fn(async () => undefined),
  })),
}));

import { createDb, disconnectDb, getDb, initDb } from "../db.js";

describe("db.ts — runtime client wiring", () => {
  beforeEach(async () => {
    // Each test starts from a no-singleton state so the order of
    // tests in the same worker can't bleed singleton state.
    await disconnectDb();
  });
  afterAll(async () => {
    await disconnectDb();
  });

  it("getDb throws before initDb has been called", () => {
    expect(() => getDb()).toThrow(/not initialized/i);
  });

  it("initDb throws when neither options.databaseUrl nor MUD_DATABASE_URL is set", async () => {
    const original = process.env.MUD_DATABASE_URL;
    delete process.env.MUD_DATABASE_URL;
    try {
      await expect(initDb()).rejects.toThrow(/MUD_DATABASE_URL/);
    } finally {
      if (original !== undefined) process.env.MUD_DATABASE_URL = original;
    }
  });

  it("createDb builds a client without touching the singleton", () => {
    const client = createDb({
      databaseUrl: "postgresql://user:pass@localhost:5432/dummy",
    });
    expect(typeof client.$disconnect).toBe("function");
    // Singleton untouched.
    expect(() => getDb()).toThrow(/not initialized/i);
  });

  it("createDb requires a databaseUrl when no env is set", () => {
    const original = process.env.MUD_DATABASE_URL;
    delete process.env.MUD_DATABASE_URL;
    try {
      expect(() => createDb()).toThrow(/databaseUrl required/);
    } finally {
      if (original !== undefined) process.env.MUD_DATABASE_URL = original;
    }
  });
});
