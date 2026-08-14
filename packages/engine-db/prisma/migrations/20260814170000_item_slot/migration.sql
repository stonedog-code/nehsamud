-- Give an item a slot, distinct from its type.
--
-- `type` says what a thing IS (weapon, armour, consumable, lightsource,
-- misc). `slot` says WHERE IT GOES. Equipping keyed off `type` alone, and
-- because every piece of armour shares one type, putting on a helmet took
-- off your shield: a character could wear exactly one piece of armour.
--
-- Nullable, and null means "cannot be equipped". Additive over items seeded
-- before slots existed — they read as unequippable until the seed re-runs
-- and the pack declares where each of them goes.
--
-- Deliberately a free string rather than an enum. The slot names are pack
-- data: a fantasy world has head/body/shield, and some other world will
-- have something else. The engine only enforces "one equipped item per
-- slot" and never asks what a slot means, so an enum here would be the
-- genre creeping back into the schema (PRD-0002 R6-R8).

ALTER TABLE "mud"."item" ADD COLUMN "slot" VARCHAR(32);

-- Backfill what the old single-slot rule already implied, so a database
-- that is not re-seeded keeps working rather than having every item become
-- unequippable. Weapons and lightsources had exactly one slot each already;
-- armour is the one that was wrong, and every piece of it lands in "body"
-- here — which reproduces the OLD behaviour exactly (one armour slot) until
-- the pack re-seeds with real slots. Wrong-but-unchanged beats silently
-- disarming everybody.
UPDATE "mud"."item" SET "slot" = 'weapon' WHERE "type" = 1;
UPDATE "mud"."item" SET "slot" = 'body'   WHERE "type" = 2;
UPDATE "mud"."item" SET "slot" = 'light'  WHERE "type" = 4;
