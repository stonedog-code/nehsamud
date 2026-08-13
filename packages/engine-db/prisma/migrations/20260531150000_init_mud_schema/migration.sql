-- Initial migration. Creates the `mud` Postgres schema and every
-- table the hopper-mud backend will read/write. Seeds the read-mostly
-- catalog (races + classes) so the character-creation modal has
-- something to display the moment this migration applies.
--
-- Items, monsters, and rooms are NOT seeded here — they're owned by
-- the upstream Python InitializeDatabase code and will be migrated
-- across once the Postgres switch lands (PR-3h). Seeding here would
-- conflict with that work.

CREATE SCHEMA IF NOT EXISTS "mud";

-- ── Race ────────────────────────────────────────────────────────────
CREATE TABLE "mud"."race" (
    "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "slug"                        VARCHAR(50)  NOT NULL,
    "name"                        VARCHAR(50)  NOT NULL,
    "description"                 TEXT         NOT NULL,
    "abilities"                   TEXT[]       NOT NULL DEFAULT '{}',
    "directives"                  TEXT[]       NOT NULL DEFAULT '{}',
    "strength_mod"                INTEGER      NOT NULL DEFAULT 0,
    "intelligence_mod"            INTEGER      NOT NULL DEFAULT 0,
    "wisdom_mod"                  INTEGER      NOT NULL DEFAULT 0,
    "charisma_mod"                INTEGER      NOT NULL DEFAULT 0,
    "constitution_mod"            INTEGER      NOT NULL DEFAULT 0,
    "dexterity_mod"               INTEGER      NOT NULL DEFAULT 0,
    "luck_mod"                    INTEGER      NOT NULL DEFAULT 0,
    "base_experience_adjustment"  INTEGER      NOT NULL DEFAULT 0,
    "playable"                    BOOLEAN      NOT NULL DEFAULT true,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "race_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "race_slug_unique" UNIQUE ("slug"),
    CONSTRAINT "race_name_unique" UNIQUE ("name")
);

-- ── Class ───────────────────────────────────────────────────────────
CREATE TABLE "mud"."class" (
    "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "slug"                        VARCHAR(50)  NOT NULL,
    "name"                        VARCHAR(50)  NOT NULL,
    "description"                 TEXT         NOT NULL,
    "abilities"                   TEXT[]       NOT NULL DEFAULT '{}',
    "directives"                  TEXT[]       NOT NULL DEFAULT '{}',
    "strength_mod"                INTEGER      NOT NULL DEFAULT 0,
    "intelligence_mod"            INTEGER      NOT NULL DEFAULT 0,
    "wisdom_mod"                  INTEGER      NOT NULL DEFAULT 0,
    "charisma_mod"                INTEGER      NOT NULL DEFAULT 0,
    "constitution_mod"            INTEGER      NOT NULL DEFAULT 0,
    "dexterity_mod"               INTEGER      NOT NULL DEFAULT 0,
    "luck_mod"                    INTEGER      NOT NULL DEFAULT 0,
    "base_experience_adjustment"  INTEGER      NOT NULL DEFAULT 0,
    "playable"                    BOOLEAN      NOT NULL DEFAULT true,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_pkey"       PRIMARY KEY ("id"),
    CONSTRAINT "class_slug_unique" UNIQUE ("slug"),
    CONSTRAINT "class_name_unique" UNIQUE ("name")
);

-- ── Room ────────────────────────────────────────────────────────────
CREATE TABLE "mud"."room" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "enum_key"    VARCHAR(100) NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT         NOT NULL,
    "exits"       JSONB        NOT NULL DEFAULT '{}',
    "image_name"  VARCHAR(255),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_pkey"          PRIMARY KEY ("id"),
    CONSTRAINT "room_enum_key_unique" UNIQUE ("enum_key")
);

-- ── Item ────────────────────────────────────────────────────────────
CREATE TABLE "mud"."item" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT         NOT NULL,
    "type"        INTEGER      NOT NULL,
    "base_value"  INTEGER,
    "weight"      INTEGER      NOT NULL DEFAULT 1,
    "image_name"  VARCHAR(255),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "item_name_unique" UNIQUE ("name")
);

-- ── Monster ─────────────────────────────────────────────────────────
CREATE TABLE "mud"."monster" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "slug"        VARCHAR(50)  NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT         NOT NULL,
    "level"       INTEGER      NOT NULL DEFAULT 1,
    "base_hp"     INTEGER      NOT NULL,
    "base_damage" INTEGER      NOT NULL,
    "experience"  INTEGER      NOT NULL DEFAULT 0,
    "image_name"  VARCHAR(255),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monster_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "monster_slug_unique" UNIQUE ("slug")
);

-- ── Player ──────────────────────────────────────────────────────────
-- Cross-schema FK to public.user.user_id. Postgres handles cross-
-- schema FKs natively as long as both schemas live in the same DB,
-- which is the deploy model we're using (hopperguard + sites + mud
-- all on the same Lightsail Postgres instance).
CREATE TABLE "mud"."player" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"             UUID         NOT NULL,
    "name"                VARCHAR(50)  NOT NULL,
    "race_id"             UUID         NOT NULL,
    "class_id"            UUID         NOT NULL,
    "room_id"             UUID,
    "level"               INTEGER      NOT NULL DEFAULT 1,
    "experience"          INTEGER      NOT NULL DEFAULT 0,
    "current_hp"          INTEGER      NOT NULL DEFAULT 10,
    "max_hp"              INTEGER      NOT NULL DEFAULT 10,
    "strength"            INTEGER      NOT NULL DEFAULT 10,
    "intelligence"        INTEGER      NOT NULL DEFAULT 10,
    "wisdom"              INTEGER      NOT NULL DEFAULT 10,
    "charisma"            INTEGER      NOT NULL DEFAULT 10,
    "constitution"        INTEGER      NOT NULL DEFAULT 10,
    "dexterity"           INTEGER      NOT NULL DEFAULT 10,
    "luck"                INTEGER      NOT NULL DEFAULT 10,
    "body_type"           VARCHAR(50),
    "sex"                 VARCHAR(50),
    "eye_color"           VARCHAR(50),
    "eye_brow"            VARCHAR(50),
    "hair_color"          VARCHAR(50),
    "hair_style"          VARCHAR(50),
    "facial_hair_style"   VARCHAR(50),
    "pin_hash"            VARCHAR(255),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,
    "last_seen_at"        TIMESTAMP(3),

    CONSTRAINT "player_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "player_name_unique" UNIQUE ("name")
);

CREATE INDEX "player_user_id_idx" ON "mud"."player" ("user_id");

ALTER TABLE "mud"."player"
    ADD CONSTRAINT "player_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mud"."player"
    ADD CONSTRAINT "player_race_id_fkey"
    FOREIGN KEY ("race_id") REFERENCES "mud"."race" ("id")
    ON UPDATE CASCADE;

ALTER TABLE "mud"."player"
    ADD CONSTRAINT "player_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "mud"."class" ("id")
    ON UPDATE CASCADE;

ALTER TABLE "mud"."player"
    ADD CONSTRAINT "player_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "mud"."room" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Inventory ───────────────────────────────────────────────────────
CREATE TABLE "mud"."inventory" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "player_id"  UUID         NOT NULL,
    "item_id"    UUID         NOT NULL,
    "quantity"   INTEGER      NOT NULL DEFAULT 1,
    "equipped"   BOOLEAN      NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_player_id_idx" ON "mud"."inventory" ("player_id");

ALTER TABLE "mud"."inventory"
    ADD CONSTRAINT "inventory_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "mud"."player" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mud"."inventory"
    ADD CONSTRAINT "inventory_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "mud"."item" ("id")
    ON UPDATE CASCADE;

-- ── Room items (dropped items) ──────────────────────────────────────
CREATE TABLE "mud"."room_item" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "room_id"    UUID         NOT NULL,
    "item_id"    UUID         NOT NULL,
    "quantity"   INTEGER      NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "room_item_room_id_idx" ON "mud"."room_item" ("room_id");

ALTER TABLE "mud"."room_item"
    ADD CONSTRAINT "room_item_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "mud"."room" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mud"."room_item"
    ADD CONSTRAINT "room_item_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "mud"."item" ("id")
    ON UPDATE CASCADE;

-- ── Seed: Races ─────────────────────────────────────────────────────
-- Source of truth for these matches apps/web's
-- mud-character-catalog.ts so the picker UI and the DB stay in sync
-- through PR-3c. Stat modifiers are placeholder values that match the
-- catalog descriptions; the upstream Python /v1/mud/races values
-- replace these once PR-3h migrates the existing SQLite contents
-- across.
INSERT INTO "mud"."race"
    (slug, name, description, strength_mod, intelligence_mod, wisdom_mod, charisma_mod, constitution_mod, dexterity_mod, luck_mod, updated_at)
VALUES
    ('human',    'Human',     'Adaptable and balanced. No starting bonuses; no penalties.',                            0, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
    ('halfling', 'Halfling',  'Small but quick. Dexterity bonus; lower strength.',                                     -1, 0, 0, 0, 0, 1, 0, CURRENT_TIMESTAMP),
    ('halfogre', 'Half-Ogre', 'Large and tough. Strength + constitution bonus; lower intelligence.',                    1, -1, 0, 0, 1, 0, 0, CURRENT_TIMESTAMP),
    ('fae',      'Fae',       'Slight, swift, magical. Intelligence + wisdom bonus; lower constitution.',               0, 1, 1, 0, -1, 0, 0, CURRENT_TIMESTAMP),
    ('arguna',   'Arguna',    'Wise traders. Charisma + intelligence bonus.',                                          0, 1, 0, 1, 0, 0, 0, CURRENT_TIMESTAMP),
    ('earea',    'Earea',     'Mountain-dwellers, sturdy and stoic. Constitution bonus.',                              0, 0, 0, 0, 1, 0, 0, CURRENT_TIMESTAMP),
    ('nyrriss',  'Nyrriss',   'Forest-born hunters. Dexterity + wisdom bonus.',                                        0, 0, 1, 0, 0, 1, 0, CURRENT_TIMESTAMP),
    ('goblin',   'Goblin',    'Crafty and cunning. Luck + dexterity bonus; lower charisma.',                           0, 0, 0, -1, 0, 1, 1, CURRENT_TIMESTAMP),
    ('kobold',   'Kobold',    'Small, scaly, organized. Intelligence bonus; lower strength.',                          -1, 1, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
    ('orc',      'Orc',       'Fierce warriors. Strength bonus; lower charisma.',                                       1, 0, 0, -1, 0, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

-- ── Seed: Classes ───────────────────────────────────────────────────
INSERT INTO "mud"."class"
    (slug, name, description, strength_mod, intelligence_mod, wisdom_mod, charisma_mod, constitution_mod, dexterity_mod, luck_mod, updated_at)
VALUES
    ('warrior',   'warrior',   'Front-line melee fighter. Strong, durable, no magic.',         1, 0, 0, 0, 1, 0, 0, CURRENT_TIMESTAMP),
    ('barbarian', 'barbarian', 'Rage-fueled berserker. Massive damage; low defense.',          2, 0, 0, 0, -1, 0, 0, CURRENT_TIMESTAMP),
    ('mage',      'mage',      'Arcane spellcaster. Powerful magic; fragile.',                 -1, 2, 0, 0, -1, 0, 0, CURRENT_TIMESTAMP),
    ('warlock',   'warlock',   'Dark pact caster. Hexes, summons, and curses.',                0, 1, 0, 1, 0, 0, 0, CURRENT_TIMESTAMP),
    ('cleric',    'cleric',    'Divine support. Healing, blessings, decent in melee.',         0, 0, 2, 0, 0, 0, 0, CURRENT_TIMESTAMP),
    ('druid',     'druid',     'Nature caster. Nature magic and animal form.',                 0, 0, 1, 0, 1, 0, 0, CURRENT_TIMESTAMP),
    ('bard',      'bard',      'Charismatic supporter. Songs, lore, and dabbling magic.',      0, 0, 0, 2, 0, 0, 0, CURRENT_TIMESTAMP),
    ('thief',     'thief',     'Stealth and finesse. Sneak attacks, lockpicking, traps.',      0, 0, 0, 0, 0, 2, 0, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;
