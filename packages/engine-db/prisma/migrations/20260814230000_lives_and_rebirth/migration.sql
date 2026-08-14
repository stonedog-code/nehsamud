-- Nine lives, then start over.
--
-- A death costs a life. At zero the character is REBORN: it keeps its name,
-- keeps a fraction of its experience, and picks its creation options again.
--
-- Deliberately not "delete the character". A permadeath MUD is a different
-- product, and the audience this engine also serves is the one least served
-- by losing everything to one bad fight. Reducing experience keeps the loss
-- real while leaving something to come back to.
--
-- Both columns are additive with defaults, so every existing character
-- silently starts at nine lives and zero rebirths — which is the correct
-- reading of "this rule did not exist when you were created".
ALTER TABLE "mud"."player" ADD COLUMN "lives"    INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "mud"."player" ADD COLUMN "rebirths" INTEGER NOT NULL DEFAULT 0;
