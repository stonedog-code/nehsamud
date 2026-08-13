-- Conceal a room item from `look`, so `search` has something to find and
-- `hide` has somewhere to put things.
--
-- The flag lives on the PLACEMENT, not on the item: the same dagger can lie
-- in plain sight in the square and be stashed under a floorboard in the inn.
-- Putting it on `mud.item` would make "hidden" a property of daggers.
--
-- Additive and defaulted, so every existing row keeps its current behaviour
-- (visible) with no backfill.
ALTER TABLE "mud"."room_item"
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

-- `look` reads the visible contents of one room on every single command, and
-- now filters on this column. Partial index rather than a plain one: the
-- overwhelming majority of rows are visible, and the hidden ones are what the
-- rare query wants.
CREATE INDEX "room_item_room_id_hidden_idx"
  ON "mud"."room_item" ("room_id")
  WHERE "hidden" = true;
