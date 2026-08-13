/**
 * Prisma 7 config — the datasource URL no longer lives in
 * `schema.prisma` (P1012 since Prisma 7.0). Runtime callers use the
 * adapter pattern via `createMudPrismaClient` in src/index.ts; the
 * URL here is read by the Prisma CLI for migrate / format / studio.
 *
 * Loads `MUD_DATABASE_URL` from the package-local `.env` (created
 * by the developer) or falls back to the process env so CI shells
 * can inject it directly.
 *
 * When it is set nowhere, this falls back to an obviously-fake URL rather
 * than throwing. `prisma generate` — which `npm run build` runs, and which
 * every fresh clone needs — validates the URL's *shape* but never connects,
 * so requiring a real database to compile the package made the repo
 * un-buildable without one. The commands that genuinely need a connection
 * (`migrate`, `studio`) still fail, and they fail naming this host, which
 * is a clearer signal than a config-load error that mentions no command.
 */
import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/** Deliberately unreachable. If a Prisma command reports a connection
 * failure against `unset.invalid`, the answer is that MUD_DATABASE_URL was
 * never set — not that the database is down. */
const PLACEHOLDER_URL =
  "postgresql://unset:unset@unset.invalid:5432/unset?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.MUD_DATABASE_URL ?? PLACEHOLDER_URL,
  },
});
