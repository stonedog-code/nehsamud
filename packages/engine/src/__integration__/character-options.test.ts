/**
 * `/character-options` against the real database (NEH-713).
 *
 * The unit tests prove the endpoint's contract with a stubbed reader. They
 * cannot prove the query, and the query is the half that matters: a mocked
 * Prisma client happily agrees with a `select` the real schema rejects, and
 * the whole reason this endpoint exists is that a client hardcoded options
 * the world did not actually have. So this tier asks the seeded world.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { PrismaClient } from "@nehsamud/engine-db";

import { createDb } from "../db.js";
import { createHttpApp } from "../http-server.js";
import { listOptionGroups } from "../persistence/player-store.js";

interface Group {
  key: string;
  name: string;
  required: boolean;
  options: Array<{ slug: string; name: string; description: string }>;
}

let prisma: PrismaClient;
let http: Server;
let base: string;

beforeAll(async () => {
  prisma = createDb({ databaseUrl: process.env.MUD_DATABASE_URL!, log: ["error"] });
  const app = createHttpApp(
    { snapshot: () => ({}) } as never,
    () => listOptionGroups(prisma),
  );
  http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await prisma.$disconnect();
});

async function fetchGroups(): Promise<{ status: number; groups: Group[] }> {
  const res = await fetch(`${base}/character-options`);
  const body = (await res.json()) as { groups?: Group[] };
  return { status: res.status, groups: body.groups ?? [] };
}

describe("GET /character-options against the seeded world", () => {
  it("returns the axes the seed actually wrote, not a hardcoded list", async () => {
    const { status, groups } = await fetchGroups();
    expect(status).toBe(200);

    // Compared against the database rather than against constants in this
    // file. Asserting `race` and `class` by name would re-create exactly the
    // bug being fixed — a test that agrees with the client's assumption
    // instead of with the world.
    const rows = await prisma.mudCharacterOptionGroup.findMany({
      select: { key: true },
    });
    expect(groups.map((g) => g.key).sort()).toEqual(
      rows.map((r) => r.key).sort(),
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  it("every offered slug is one the engine will accept at creation", async () => {
    // The endpoint's only promise. If it serves a slug that creation then
    // rejects, a picker renders a choice that fails on submit — which is
    // worse than no picker, because the player has already decided.
    const { groups } = await fetchGroups();
    for (const group of groups) {
      const valid = await prisma.mudCharacterOption.findMany({
        where: { group: { key: group.key }, selectable: true },
        select: { slug: true },
      });
      const allowed = new Set(valid.map((v) => v.slug));
      expect(group.options.length).toBeGreaterThan(0);
      for (const option of group.options) {
        expect(allowed.has(option.slug)).toBe(true);
      }
    }
  });

  it("hides options the pack marked unselectable", async () => {
    // `selectable: false` is how a pack retires an option without deleting
    // the characters that already chose it. Serving one would let a new
    // player pick something the world no longer offers.
    //
    // The seed has no retired options, so asserting over what already exists
    // would pass against an endpoint that ignored the flag entirely. Write
    // one, then take it away again.
    const group = await prisma.mudCharacterOptionGroup.findFirstOrThrow({
      select: { id: true },
    });
    const slug = "retired-for-test";
    await prisma.mudCharacterOption.create({
      data: {
        groupId: group.id,
        slug,
        name: "Retired",
        description: "Kept for existing characters only.",
        selectable: false,
      },
    });
    try {
      const { groups } = await fetchGroups();
      const served = groups.flatMap((g) => g.options.map((o) => o.slug));
      expect(served).not.toContain(slug);
      // ...and the group it belongs to is still served, so the assertion
      // above is about the flag rather than about a missing group.
      expect(served.length).toBeGreaterThan(0);
    } finally {
      await prisma.mudCharacterOption.deleteMany({ where: { slug } });
    }
  });

  it("presents groups in the pack's declared order", async () => {
    // Creation asks in a deliberate sequence; a picker rendering the axes
    // in database-default order tells a different story than the
    // conversational flow does.
    const expected = await prisma.mudCharacterOptionGroup.findMany({
      orderBy: [{ position: "asc" }, { key: "asc" }],
      select: { key: true },
    });
    const { groups } = await fetchGroups();
    expect(groups.map((g) => g.key)).toEqual(expected.map((e) => e.key));
  });
});
