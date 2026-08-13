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
    console.log(`✓ races=${counts.races}`);
    console.log(`✓ classes=${counts.classes}`);
    console.log(`✓ rooms=${counts.rooms}`);
    console.log(`✓ items=${counts.items}`);
    console.log(`✓ placed=${counts.placements}`);
    console.log(`✓ monsters=${counts.monsters}`);
    console.log(`✓ npcs=${counts.npcs}`);
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
