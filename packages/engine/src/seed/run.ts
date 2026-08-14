/**
 * CLI entry for `npm run seed`. Reads `MUD_DATABASE_URL` (or
 * `--database-url` flag) and runs the idempotent catalog seeder.
 *
 * Designed to be safe to invoke repeatedly — every Phase 4+
 * developer needs this on their first checkout and the production
 * deploy chain will hook it in at Phase 10 alongside Prisma migrate.
 */

import { createDb } from "../db.js";
import { seedCatalog } from "./seed.js";

function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const databaseUrl = parseFlag("database-url") ?? process.env.MUD_DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "✗ MUD_DATABASE_URL not set and --database-url not provided.",
    );
    process.exit(2);
  }
  const prisma = createDb({ databaseUrl, log: ["warn", "error"] });
  console.log("Seeding mud.* catalog…");
  try {
    const counts = await seedCatalog(prisma);
    console.log(
      `✓ character options=${counts.options} across ${counts.optionGroups} group(s)`,
    );
    console.log(`✓ rooms=${counts.rooms}`);
    console.log(`✓ items=${counts.items}`);
    console.log(`✓ placed=${counts.placements}`);
    console.log(`✓ hostiles=${counts.hostiles}`);
    console.log(`✓ npcs=${counts.npcs}`);

    // Everything removed is named. A seed that silently deletes content is
    // as bad as one that silently keeps it, and a relocated player is
    // something an operator should hear about here rather than from a
    // support ticket.
    const { pruned } = counts;
    const removals: Array<[string, string[]]> = [
      ["rooms", pruned.rooms],
      ["npcs", pruned.npcs],
      ["items", pruned.items],
      ["hostiles", pruned.hostiles],
      ["character option groups", pruned.optionGroups],
      ["character options", pruned.options],
    ];
    const removed = removals.filter(([, keys]) => keys.length > 0);
    if (removed.length === 0) {
      console.log("✓ pruned nothing — the catalog already matched the fixtures");
    } else {
      for (const [label, keys] of removed) {
        console.log(`✂ pruned ${keys.length} ${label}: ${keys.join(", ")}`);
      }
    }
    if (pruned.playersRelocated > 0) {
      console.log(
        `↪ moved ${pruned.playersRelocated} player(s) to the spawn: the room they were standing in no longer exists`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("✗ seed failed:", err);
    process.exit(1);
  });
