/**
 * Townsmee room catalog. The playable map.
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/townsmee.py.
 * Focused-rewrite subset:
 *   - All 12 named indoor locations (square, tavern, inn + two
 *     upper floors, blacksmith + backroom, market, armoury,
 *     sheriff's office, gallows, lower quarter).
 *   - 6 named outdoor streets (north/south sunroad, east/west
 *     moonroad, mindroad bridge, talentroad).
 * Dropped: the 50+ "outer wall (Inside West)---N" sequential
 * rooms that all share the same description and exist only to pad
 * the map. The Phase 4 command processor can synthesize generic
 * "you continue along the wall" responses if the demo ever needs
 * that area; a unique row per padding cell wasn't earning the
 * storage cost.
 */

import type { RoomFixture } from "./types.js";

export const ROOMS: RoomFixture[] = [
  /* ── Town centre ──────────────────────────────────────────── */
  {
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description:
      "You are in the town square of Townsmee. It's a large open cobblestone area with a bronze " +
      "fountain shaped like a dire wolf, water jetting from its open mouth. There's a festive feeling " +
      "to the area; people and wagons move with purpose in all directions. Roads lead north, south, " +
      "east and west.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_SUNROAD_NORTH1",
      south: "TOWNSMEE_SUNROAD_SOUTH1",
      east: "TOWNSMEE_MOONROAD_EAST1",
      west: "TOWNSMEE_MOONROAD_WEST1",
    },
  },

  /* ── Indoor — inn, tavern, sheriff's office, blacksmith ──── */
  {
    enumKey: "TOWNSMEE_INN",
    name: "The Quiet Bed (Ground Floor)",
    description:
      "A majestic inn. A worn fireplace burns softly in the corner. A shelf holds a small assortment " +
      "of books, and a prized map of the town and surrounding area stands on display behind glass. " +
      "Stairs lead up; the door east returns to the moonroad.",
    environment: "townsmee",
    exits: {
      up: "TOWNSMEE_INN_SECOND",
      east: "TOWNSMEE_MOONROAD_WEST1",
    },
  },
  {
    enumKey: "TOWNSMEE_INN_SECOND",
    name: "The Quiet Bed (Second Floor)",
    description:
      "The second floor of the inn. Rooms line the hallway. Stairs go up and down.",
    environment: "townsmee",
    exits: {
      up: "TOWNSMEE_INN_THIRD",
      down: "TOWNSMEE_INN",
    },
  },
  {
    enumKey: "TOWNSMEE_INN_THIRD",
    name: "The Quiet Bed (Third Floor)",
    description:
      "The third floor of the inn. Rooms line the hallway. A beautiful vase with daisies sits on a " +
      "table in broad view.",
    environment: "townsmee",
    exits: {
      down: "TOWNSMEE_INN_SECOND",
    },
  },
  {
    enumKey: "TOWNSMEE_TAVERN",
    name: "The Cracked Tankard",
    description:
      "Low-ceilinged, smelling of pipe smoke and stew. A long bar runs along the back wall and a " +
      "fire crackles in the hearth. The exit south returns to the sunroad.",
    environment: "townsmee",
    exits: {
      south: "TOWNSMEE_SUNROAD_NORTH1",
    },
  },
  {
    enumKey: "TOWNSMEE_SHERIFF",
    name: "Sheriff's Office",
    description:
      "A locked cell stands in the corner — currently empty, the cell door slightly ajar. A young " +
      "distraught woman is pleading and gesturing to someone through a small window into the back. " +
      "The exit west returns to the market plaza.",
    environment: "townsmee",
    exits: {
      west: "TOWNSMEE_MARKET",
    },
  },
  {
    enumKey: "TOWNSMEE_BLACKSMITH",
    name: "Blacksmith",
    description:
      "The blacksmith's shop. An assortment of wares are on display on iron-bound racks. A doorway " +
      "leads into the back room; the front door goes south to the moonroad. A side gate opens " +
      "southeast onto the market stalls.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_BLACKSMITH_BACK",
      south: "TOWNSMEE_MOONROAD_EAST1",
      // The one diagonal in Townsmee, and it is geometrically honest rather
      // than decorative: the smithy sits north of the moonroad and the market
      // east of it, so the two are corner to corner. Paired with the market's
      // `northwest` — the bidirectional-exits invariant requires it.
      southeast: "TOWNSMEE_MARKET",
    },
  },
  {
    enumKey: "TOWNSMEE_BLACKSMITH_BACK",
    name: "Blacksmith — Back Room",
    description:
      "A hot forge still burns smoldering coals. The exit south returns to the front shop.",
    environment: "townsmee",
    exits: {
      south: "TOWNSMEE_BLACKSMITH",
    },
  },
  {
    enumKey: "TOWNSMEE_MARKET",
    name: "Townsmee Market",
    description:
      "A handful of stalls arranged around a packed-dirt plaza. A merchant nods at you from the " +
      "nearest. The sheriff's office is east; the exit west returns to the moonroad, and a side " +
      "gate northwest cuts through to the blacksmith.",
    environment: "townsmee",
    exits: {
      west: "TOWNSMEE_MOONROAD_EAST1",
      east: "TOWNSMEE_SHERIFF",
      northwest: "TOWNSMEE_BLACKSMITH",
    },
  },
  {
    enumKey: "TOWNSMEE_ARMOURY",
    name: "Armoury",
    description:
      "The town armoury — racks of practice weapons line one wall; a quartermaster's desk faces the " +
      "door. The exit south leads to the lower quarter.",
    environment: "townsmee",
    exits: {
      south: "TOWNSMEE_LOWER_QUARTER",
    },
  },
  {
    enumKey: "TOWNSMEE_GALLOWS",
    name: "The Gallows",
    description:
      "A grim platform with a single noose and a worn execution log nailed to the side. The exit " +
      "north returns to the southern sunroad.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_SUNROAD_SOUTH2",
    },
  },
  {
    enumKey: "TOWNSMEE_LOWER_QUARTER",
    name: "Lower Quarter",
    description:
      "A run-down district where the cobblestones turn to dirt. The smell of refuse hangs heavy. " +
      "The exit north leads to the armoury; the exit east leads back toward the mindroad bridge.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_ARMOURY",
      east: "TOWNSMEE_MINDROAD_BRIDGE",
    },
  },

  /* ── Outdoor — sunroad (north/south thoroughfare) ────────── */
  {
    enumKey: "TOWNSMEE_SUNROAD_NORTH1",
    name: "Sunroad — North Block 1",
    description:
      "You're on the sunroad, Townsmee's north-south thoroughfare. The street is broad enough for " +
      "two wagons to pass. Tavern signs creak overhead.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_TAVERN",
      south: "TOWNSMEE_TOWNSQUARE",
    },
  },
  {
    enumKey: "TOWNSMEE_SUNROAD_SOUTH1",
    name: "Sunroad — South Block 1",
    description:
      "The sunroad continues south. The crowd thins; the buildings turn quieter.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_TOWNSQUARE",
      south: "TOWNSMEE_SUNROAD_SOUTH2",
    },
  },
  {
    enumKey: "TOWNSMEE_SUNROAD_SOUTH2",
    name: "Sunroad — South Block 2",
    description:
      "Further south on the sunroad. The gallows loom to the south; the cross-street talentroad " +
      "branches east.",
    environment: "townsmee",
    exits: {
      north: "TOWNSMEE_SUNROAD_SOUTH1",
      south: "TOWNSMEE_GALLOWS",
      east: "TOWNSMEE_TALENTROAD",
    },
  },

  /* ── Outdoor — moonroad (east/west thoroughfare) ─────────── */
  {
    enumKey: "TOWNSMEE_MOONROAD_WEST1",
    name: "Moonroad — West Block 1",
    description:
      "You're on the moonroad heading west. The inn's signboard hangs over the road just ahead.",
    environment: "townsmee",
    exits: {
      east: "TOWNSMEE_TOWNSQUARE",
      west: "TOWNSMEE_INN",
    },
  },
  {
    enumKey: "TOWNSMEE_MOONROAD_EAST1",
    name: "Moonroad — East Block 1",
    description:
      "You're on the moonroad heading east. The blacksmith's shop stands to the north; the market " +
      "and (beyond it) the sheriff's office lie east.",
    environment: "townsmee",
    exits: {
      west: "TOWNSMEE_TOWNSQUARE",
      east: "TOWNSMEE_MARKET",
      north: "TOWNSMEE_BLACKSMITH",
    },
  },

  /* ── Outdoor — bridge + talentroad (less travelled) ─────── */
  {
    enumKey: "TOWNSMEE_MINDROAD_BRIDGE",
    name: "Mindroad Bridge",
    description:
      "A timber-and-iron bridge spans a slow brown river. The bridgeposts are carved with old runes " +
      "that have weathered into shapes you can't quite read. West leads to the lower quarter.",
    environment: "townsmee",
    exits: {
      west: "TOWNSMEE_LOWER_QUARTER",
    },
  },
  {
    enumKey: "TOWNSMEE_TALENTROAD",
    name: "Talentroad",
    description:
      "A narrow side street lined with craftsman's workshops, mostly shuttered at this hour. The " +
      "exit west returns to the sunroad.",
    environment: "townsmee",
    exits: {
      west: "TOWNSMEE_SUNROAD_SOUTH2",
    },
  },
];
