/**
 * Barrowdeep — the dungeon, and the far end of the difficulty ramp.
 *
 * Two levels, reached by `down` from the Barrow Mouth in the wilds. Vertical
 * movement is the point of a dungeon being a dungeon rather than more heath:
 * `up` and `down` are directions the parser has always had and no room in
 * the world used.
 *
 * DEAD ENDS ARE DELIBERATE HERE, unlike in the wilds. A barrow is a built
 * thing with side chambers; the lattice shape that makes open country feel
 * open makes a tomb feel like a field. Every dead end holds something —
 * loot, a hostile, or a piece of the story on the walls — because a dead end
 * that holds nothing is just a wasted walk.
 */

import type { RoomFixture } from "./types.js";

const UPPER = "barrowdeep-upper";
const DEEP = "barrowdeep-deep";

export const BARROWDEEP_ROOMS: RoomFixture[] = [
  /* ── Upper level ──────────────────────────────────────────── */
  {
    enumKey: "BARROW_ENTRY_HALL",
    name: "Barrowdeep — Entry Hall",
    description:
      "A low hall of dressed stone, the ceiling held by four squat pillars. Daylight reaches about " +
      "as far as the second pair and then gives up. The air is dry and still and much colder than " +
      "the hillside above.",
    environment: "barrow-stone",
    area: UPPER,
    exits: {
      up: "WILDS_BARROW_MOUTH",
      north: "BARROW_PILLARED_WAY",
      east: "BARROW_SIDE_CHAMBER",
    },
  },
  {
    enumKey: "BARROW_SIDE_CHAMBER",
    name: "Barrowdeep — Side Chamber",
    description:
      "A square room with shelves cut into three walls, most of them empty. What is left has been " +
      "gone through carefully by someone who knew what they were looking for and was not in a hurry.",
    environment: "barrow-stone",
    area: UPPER,
    exits: {
      west: "BARROW_ENTRY_HALL",
    },
  },
  {
    enumKey: "BARROW_PILLARED_WAY",
    name: "Barrowdeep — The Pillared Way",
    description:
      "The hall narrows into a corridor lined with pillars, each carved as a standing figure with " +
      "its face deliberately struck off. The corridor runs north; a stair goes down to the west.",
    environment: "barrow-stone",
    area: UPPER,
    exits: {
      south: "BARROW_ENTRY_HALL",
      north: "BARROW_ANTECHAMBER",
      west: "BARROW_STAIR_HEAD",
    },
  },
  {
    enumKey: "BARROW_STAIR_HEAD",
    name: "Barrowdeep — Stair Head",
    description:
      "A shaft with steps cut around its inside wall, spiralling down past the reach of any light " +
      "you are carrying. The stone here is wet, which nothing else in the barrow is.",
    environment: "barrow-stone",
    area: UPPER,
    exits: {
      east: "BARROW_PILLARED_WAY",
      down: "BARROW_LOWER_LANDING",
    },
  },
  {
    enumKey: "BARROW_ANTECHAMBER",
    name: "Barrowdeep — Antechamber",
    description:
      "A wide room with a stone bench running its full circumference, as though people once waited " +
      "here in numbers. The north wall is a single slab, fitted so closely you could not get a knife " +
      "into the seam. It does not open.",
    environment: "barrow-stone",
    area: UPPER,
    exits: {
      south: "BARROW_PILLARED_WAY",
      east: "BARROW_OSSUARY",
    },
  },
  {
    enumKey: "BARROW_OSSUARY",
    name: "Barrowdeep — Ossuary",
    description:
      "Bones stacked by kind — long bones one wall, skulls another, all of it sorted with real care " +
      "a very long time ago. Something has been through the far corner recently and sorted nothing.",
    environment: "barrow-bone",
    area: UPPER,
    exits: {
      west: "BARROW_ANTECHAMBER",
    },
  },

  /* ── Lower level ──────────────────────────────────────────── */
  {
    enumKey: "BARROW_LOWER_LANDING",
    name: "Barrowdeep — Lower Landing",
    description:
      "The bottom of the shaft. Water runs somewhere behind the walls, close enough to hear and " +
      "nowhere you can see. The stonework down here is older and rougher than the level above — " +
      "the barrow was built on top of something.",
    environment: "barrow-deep",
    area: DEEP,
    exits: {
      up: "BARROW_STAIR_HEAD",
      north: "BARROW_FLOODED_GALLERY",
      east: "BARROW_CARVED_CELL",
    },
  },
  {
    enumKey: "BARROW_CARVED_CELL",
    name: "Barrowdeep — Carved Cell",
    description:
      "A cell barely wide enough to lie down in. Every surface, including the ceiling, is covered " +
      "edge to edge in the same short phrase, scratched thousands of times by someone who had a " +
      "great deal of time and only one thing to say.",
    environment: "barrow-deep",
    area: DEEP,
    exits: {
      west: "BARROW_LOWER_LANDING",
    },
  },
  {
    enumKey: "BARROW_FLOODED_GALLERY",
    name: "Barrowdeep — Flooded Gallery",
    description:
      "Ankle-deep black water across a long gallery, still enough to mirror the ceiling. Whatever is " +
      "underfoot is not flat. The far end continues north; a dry alcove opens west.",
    environment: "barrow-water",
    area: DEEP,
    exits: {
      south: "BARROW_LOWER_LANDING",
      north: "BARROW_INNER_VAULT",
      west: "BARROW_DRY_ALCOVE",
    },
  },
  {
    enumKey: "BARROW_DRY_ALCOVE",
    name: "Barrowdeep — Dry Alcove",
    description:
      "A raised alcove above the waterline, dry and oddly warm. Someone sheltered here — a bedroll " +
      "rotted to threads, a lamp with oil still in it, and a pack nobody came back for.",
    environment: "barrow-deep",
    area: DEEP,
    exits: {
      east: "BARROW_FLOODED_GALLERY",
    },
  },
  {
    enumKey: "BARROW_INNER_VAULT",
    name: "Barrowdeep — The Inner Vault",
    description:
      "The room the whole hill was built to hold. A single plinth, a bowl cut into its top, and heat " +
      "coming off the stone hard enough to feel from the doorway. The bowl is not empty.",
    environment: "barrow-vault",
    area: DEEP,
    exits: {
      south: "BARROW_FLOODED_GALLERY",
    },
  },
];
