-- Prepare a database that nehsamud owns outright, before the migrations run.
--
-- This exists because of one line in the init migration: `mud.player.user_id`
-- carries a foreign key to `public.user(user_id)` — a table this package does
-- not own, does not create, and cannot assume. That is fine in the deploy
-- model it was written for (HopperGuard and the mud sharing one Postgres) and
-- fatal to a standalone deployment, which is the entire premise of the
-- standalone app.
--
-- There is no ordering that works without help:
--
--   * migrate first          → "relation public.user does not exist"
--   * create the table first → the database is no longer empty, and Prisma
--                              refuses with P3005, telling you to baseline
--
-- So this does both halves of the baseline: the stand-in table, and an empty
-- `_prisma_migrations` so Prisma treats the database as one it is managing
-- rather than one it has been pointed at by mistake. Every migration then
-- applies normally.
--
-- THIS IS A WORKAROUND AND SHOULD NOT SURVIVE. The real fix is dropping the
-- cross-schema FK for an opaque owner id — PRD-0002 phase 3 (NEH-650). It was
-- not done here because it also removes HopperGuard's ON DELETE CASCADE from
-- Hopper user to MUD character, and changing another product's data-deletion
-- behaviour inside a web-app PR is not a trade worth making quietly.
--
-- The stand-in is deliberately minimal: one column, no behaviour. Nothing
-- should ever read from it.

CREATE TABLE IF NOT EXISTS "public"."user" (
    "user_id" UUID PRIMARY KEY
);

-- Prisma's own bookkeeping table, created empty. `migrate deploy` treats a
-- database with this table as one it manages, and applies everything.
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36)  PRIMARY KEY,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
);
