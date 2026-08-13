-- Phase 2 of the hopper-mud Python → Node rewrite.
--
-- Adds:
--   * mud.room.environment (varchar, nullable) — collapses the
--     Python `environments` lookup table into a denormalized column.
--   * mud.monster.alignment + mud.monster.mob_type (varchar with
--     defaults) — collapses the Python `alignments` and `mob_types`
--     lookup tables into denormalized columns.
--   * mud.npc — net-new NPC catalog. NPCs are non-hostile and
--     dialog-capable; intentionally distinct from mud.monster.
--
-- Why columns instead of tables: the Python `alignments`,
-- `mob_types`, and `environments` tables held 4 / ~8 / ~10 rows
-- respectively and existed solely to constrain a string value with
-- a foreign key. The focused rewrite drops the indirection — both
-- the Node application layer and the seeds enforce the same vocab
-- without the join.

ALTER TABLE "mud"."room"
    ADD COLUMN "environment" VARCHAR(50);

ALTER TABLE "mud"."monster"
    ADD COLUMN "alignment" VARCHAR(20) NOT NULL DEFAULT 'neutral',
    ADD COLUMN "mob_type"  VARCHAR(20) NOT NULL DEFAULT 'humanoid';

CREATE TABLE "mud"."npc" (
    "id"                UUID         NOT NULL,
    "slug"              VARCHAR(50)  NOT NULL,
    "name"              VARCHAR(255) NOT NULL,
    "description"       TEXT         NOT NULL,
    "room_id"           UUID,
    "pronoun"           VARCHAR(10)  NOT NULL DEFAULT 'they',
    "alignment"         VARCHAR(20)  NOT NULL DEFAULT 'neutral',
    "intelligence_mode" VARCHAR(20)  NOT NULL DEFAULT 'canned',
    "dialog_lines"      TEXT[]       NOT NULL DEFAULT '{}',
    "interests"         TEXT[]       NOT NULL DEFAULT '{}',
    "image_name"        VARCHAR(255),
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "npc_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "npc_slug_key" ON "mud"."npc"("slug");
CREATE INDEX "npc_room_id_idx" ON "mud"."npc"("room_id");

ALTER TABLE "mud"."npc"
    ADD CONSTRAINT "npc_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "mud"."room"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
