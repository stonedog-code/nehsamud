/**
 * Smoke coverage for the public surface — we don't want to bring up
 * a real Postgres here, so this verifies:
 *   - The factory builds a PrismaClient instance without throwing.
 *   - The re-exported `PrismaClient` and `Prisma` symbols actually
 *     resolve (regression for ESM/CJS dual-build slips).
 *   - `Prisma.PrismaClientKnownRequestError` is a real class — proof
 *     that the runtime export from `@prisma/client` is being
 *     re-exported, not just a typings-only mirror.
 */

import { createMudPrismaClient, Prisma, PrismaClient } from "../index.js";

describe("hopper-mud-db public surface", () => {
  it("builds a PrismaClient with the public methods callers depend on", () => {
    const client = createMudPrismaClient({
      databaseUrl: "postgresql://user:pass@localhost:5432/dummy",
    });
    // Avoid `instanceof PrismaClient` — Prisma's dual ESM/CJS build
    // means the imported symbol can resolve to a different
    // constructor than the one used to build the instance in the
    // generated client. Method-shape probing is enough.
    expect(typeof client.$disconnect).toBe("function");
    expect(typeof client.$connect).toBe("function");
    // Phase 2 callsites the MUD service will use:
    expect(typeof client.mudRoom.findUnique).toBe("function");
    expect(typeof client.mudNpc.findMany).toBe("function");
    expect(typeof client.mudMonster.upsert).toBe("function");
  });

  it("exports the PrismaClient symbol for direct typing", () => {
    expect(typeof PrismaClient).toBe("function");
  });

  it("re-exports Prisma namespace with a usable error class", () => {
    // Reaching for one of the known error classes is the cheapest
    // way to assert the runtime re-export isn't typings-only.
    expect(typeof Prisma.PrismaClientKnownRequestError).toBe("function");
  });

  it("accepts optional log levels", () => {
    expect(() =>
      createMudPrismaClient({
        databaseUrl: "postgresql://user:pass@localhost:5432/dummy",
        log: ["info", "warn", "error"],
      }),
    ).not.toThrow();
  });
});
