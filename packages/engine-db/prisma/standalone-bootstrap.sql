-- Prepare a database that nehsamud owns outright, before the migrations run.
--
-- This exists because of one line in the INIT migration: `mud.player.user_id`
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
-- WHY THIS IS STILL HERE AFTER THE FK WAS DROPPED. Two later migrations
-- remove the constraint (20260814054500) and rename the column to `owner_id`
-- (20260814150000), so no CURRENT schema references `public.user` at all.
-- But `migrate deploy` replays history from the beginning, and the init
-- migration still creates the constraint on its way past. Verified against an
-- empty database on 2026-08-14: without this file the deploy still dies at
-- migration 1 with `42P01`.
--
-- Removing it therefore means editing the init migration, which changes its
-- checksum and breaks `migrate deploy` on every database that has already
-- applied it — including production. That is a squash-and-baseline job with
-- an operator step on both live databases, not a code change, and it is worth
-- doing only when something else already requires one.
--
-- The stand-in is deliberately minimal: one column, no behaviour. Nothing
-- reads from it, and after the migrations run nothing references it either.

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
