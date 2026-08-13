-- Group rooms into named regions.
--
-- `environment` was doing this job and its own at once — it was the region
-- name AND the per-room art hint — which worked only while there was exactly
-- one region. Now that the map has four, the two roles need separate columns:
-- two rooms in one area can look nothing alike.
--
-- Additive and defaulted, so every existing row keeps working with no
-- backfill; the seeder overwrites it with the fixture's real value on the
-- next run.
ALTER TABLE "mud"."room"
  ADD COLUMN "area" VARCHAR(64) NOT NULL DEFAULT 'townsmee';

-- `look` renders the area name on every room render, and future per-area
-- queries (spawn tables, area-scoped broadcasts) filter on it.
CREATE INDEX "room_area_idx" ON "mud"."room" ("area");
