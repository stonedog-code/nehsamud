-- Make `mud.player.user_id` an opaque owner id instead of a foreign key.
--
-- It referenced `public.user(user_id)` — a table this package does not own,
-- does not create, and cannot assume exists. That was a reasonable shortcut
-- for the deploy model it was written for (HopperGuard and the mud sharing
-- one Postgres) and it blocks the standalone product in two separate ways:
--
--   1. A database of its own cannot be migrated. `migrate deploy` against an
--      empty database fails with `relation "public.user" does not exist`, and
--      creating the table first makes the database non-empty so Prisma then
--      refuses with P3005.
--   2. A character cannot be created. The standalone site has no account
--      model, so its owner ids are per-session uuids that appear in nobody's
--      user table — every `create` died on
--      `Foreign key constraint violated on the constraint: player_user_id_fkey`.
--
-- The only workaround for (2) would be the app inserting rows into another
-- product's table, which is worse than this.
--
-- `user_id` stays exactly as it is, in name and type. It just stops being
-- enforced: the HOST decides what it means. HopperGuard writes a Hopper user
-- id, the standalone site writes a session uuid, and the engine neither knows
-- nor cares. This is PRD-0002 phase 3's "cross-schema FK dropped for an
-- opaque owner_id", brought forward because it blocks the standalone app.
--
-- WHAT THIS CHANGES FOR HOPPERGUARD, PLAINLY: the constraint carried
-- ON DELETE CASCADE, so deleting a Hopper account removed that person's MUD
-- characters as a side effect of referential integrity. IT NO LONGER DOES.
-- Account deletion must delete them explicitly. Tracked separately, and worth
-- closing before the next account deletion rather than after.
ALTER TABLE "mud"."player"
  DROP CONSTRAINT IF EXISTS "player_user_id_fkey";

-- The FK's implicit index goes with it, and every login looks a player up by
-- owner.
CREATE INDEX IF NOT EXISTS "player_user_id_idx" ON "mud"."player" ("user_id");
