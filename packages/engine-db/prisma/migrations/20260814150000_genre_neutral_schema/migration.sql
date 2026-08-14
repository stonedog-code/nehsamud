-- Rebuild the `mud` schema so it carries no genre.
--
-- PRD-0002 R6–R9 and R14. One engine serves worlds that share nothing
-- thematically — a fantasy MUD and a virtual senior-care centre — and until
-- now the fantasy one was compiled into the schema: a `monster` table, a
-- `race` table, an `alignment` column with four moral positions in it.
--
-- WHY THIS IS ONE MIGRATION AND NOT A CAREFUL SEQUENCE OF ALTERS.
-- Measured against production on 2026-08-13:
--
--     player|0    inventory|0    room_item|0    room|19
--
-- Zero player rows. Nobody has ever created a character, so there is no
-- character data to preserve and this is a rewrite rather than a data
-- migration. That stops being true the first time somebody creates one,
-- which is why this is being done now.
--
-- Catalog rows (rooms, items, hostiles, NPCs) are regenerable by definition
-- — both worlds re-seed from their packs afterwards — so this migration does
-- not try to carry content forward beyond what a rename gets for free.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH: `public.user`. On a shared database
-- that is another product's table. The FK into it is already gone
-- (20260814054500); nothing here should so much as read it.

/* ── 1. Character options replace race and class ─────────────────────
 *
 * `race` and `class` were two hardcoded axes, which meant every world had
 * exactly those two and could have no others. A pack now declares its own:
 * fantasy ships Race and Class, a care centre may ship Background and Room,
 * a minimal pack may ship none.
 */

CREATE TABLE "mud"."character_option_group" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "key"         VARCHAR(50)  NOT NULL,
    "name"        VARCHAR(50)  NOT NULL,
    "description" TEXT         NOT NULL,
    "position"    INTEGER      NOT NULL DEFAULT 0,
    "required"    BOOLEAN      NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_option_group_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_option_group_key_key"
    ON "mud"."character_option_group" ("key");
CREATE UNIQUE INDEX "character_option_group_name_key"
    ON "mud"."character_option_group" ("name");

CREATE TABLE "mud"."character_option" (
    "id"                         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "group_id"                   UUID         NOT NULL,
    "slug"                       VARCHAR(50)  NOT NULL,
    "name"                       VARCHAR(50)  NOT NULL,
    "description"                TEXT         NOT NULL,
    "abilities"                  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "directives"                 TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "strength_mod"               INTEGER      NOT NULL DEFAULT 0,
    "intelligence_mod"           INTEGER      NOT NULL DEFAULT 0,
    "wisdom_mod"                 INTEGER      NOT NULL DEFAULT 0,
    "charisma_mod"               INTEGER      NOT NULL DEFAULT 0,
    "constitution_mod"           INTEGER      NOT NULL DEFAULT 0,
    "dexterity_mod"              INTEGER      NOT NULL DEFAULT 0,
    "luck_mod"                   INTEGER      NOT NULL DEFAULT 0,
    "base_experience_adjustment" INTEGER      NOT NULL DEFAULT 0,
    "selectable"                 BOOLEAN      NOT NULL DEFAULT true,
    "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_option_pkey" PRIMARY KEY ("id")
);

-- Slug and name are unique WITHIN a group, not globally: two packs' groups
-- may both reasonably offer a "standard".
CREATE UNIQUE INDEX "character_option_group_id_slug_key"
    ON "mud"."character_option" ("group_id", "slug");
CREATE UNIQUE INDEX "character_option_group_id_name_key"
    ON "mud"."character_option" ("group_id", "name");
CREATE INDEX "character_option_group_id_idx"
    ON "mud"."character_option" ("group_id");

ALTER TABLE "mud"."character_option"
    ADD CONSTRAINT "character_option_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "mud"."character_option_group" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The primary key is (player, group), not (player, option). That is what
-- makes "one choice per axis" a database rule rather than a convention the
-- create path is trusted to keep: a second insert for the same group is a
-- constraint violation, not a character with two races.
CREATE TABLE "mud"."player_option" (
    "player_id" UUID NOT NULL,
    "group_id"  UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "player_option_pkey" PRIMARY KEY ("player_id", "group_id")
);

CREATE INDEX "player_option_option_id_idx"
    ON "mud"."player_option" ("option_id");

/* ── 2. The player row ───────────────────────────────────────────────
 *
 * `user_id` becomes `owner_id`. It stopped being a foreign key in
 * 20260814054500; the name is what was left saying otherwise. `race_id` and
 * `class_id` become rows in player_option.
 */

ALTER TABLE "mud"."player" DROP CONSTRAINT IF EXISTS "player_race_id_fkey";
ALTER TABLE "mud"."player" DROP CONSTRAINT IF EXISTS "player_class_id_fkey";
ALTER TABLE "mud"."player" DROP COLUMN "race_id";
ALTER TABLE "mud"."player" DROP COLUMN "class_id";

ALTER TABLE "mud"."player" RENAME COLUMN "user_id" TO "owner_id";
ALTER INDEX IF EXISTS "mud"."player_user_id_idx" RENAME TO "player_owner_id_idx";

ALTER TABLE "mud"."player_option"
    ADD CONSTRAINT "player_option_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "mud"."player" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mud"."player_option"
    ADD CONSTRAINT "player_option_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "mud"."character_option_group" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mud"."player_option"
    ADD CONSTRAINT "player_option_option_id_fkey"
    FOREIGN KEY ("option_id") REFERENCES "mud"."character_option" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "mud"."race";
DROP TABLE "mud"."class";

/* ── 3. monster → hostile ────────────────────────────────────────────
 *
 * "Monster" is a genre word; the mechanic is "a thing that can be fought".
 * Renamed rather than recreated so the catalog ids survive — the seed would
 * regenerate the rows either way, but a rename cannot lose anything.
 */

ALTER TABLE "mud"."monster" RENAME TO "hostile";
ALTER TABLE "mud"."hostile" RENAME CONSTRAINT "monster_pkey" TO "hostile_pkey";
ALTER TABLE "mud"."hostile" RENAME CONSTRAINT "monster_slug_unique" TO "hostile_slug_unique";

-- `alignment` (four moral positions) and `mob_type` (five creature kinds)
-- are a fantasy bestiary's taxonomy. A tag list lets a pack classify its own
-- content without the engine having an opinion about the categories. The
-- engine reads none of them, which is the point: they are content.
ALTER TABLE "mud"."hostile"
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry what the old columns said into the new one, so a database that is
-- not re-seeded still describes its content rather than silently losing the
-- classification. Both are re-declared by the pack on the next seed.
UPDATE "mud"."hostile"
   SET "tags" = ARRAY["mob_type", "alignment"];

ALTER TABLE "mud"."hostile" DROP COLUMN "alignment";
ALTER TABLE "mud"."hostile" DROP COLUMN "mob_type";

/* ── 4. NPCs get the same treatment ──────────────────────────────── */

ALTER TABLE "mud"."npc"
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "mud"."npc" SET "tags" = ARRAY["alignment"];

ALTER TABLE "mud"."npc" DROP COLUMN "alignment";
