/**
 * The Kingsreach Wilds — the first area outside Townsmee.
 *
 * Reached east across the Mindroad Bridge, which was a dead end: it had a
 * single `west` exit back into the lower quarter and a description promising
 * a river crossing that went nowhere. Hanging the wilds off it means the way
 * out of town is somewhere a player has already been told to look.
 *
 * SHAPE, AND WHY IT IS NOT A CORRIDOR. The heath is a loose 3x3 lattice with
 * diagonals, so movement is navigation rather than a sequence of `east`s.
 * Diagonals are used deliberately and only now that the parser has all ten
 * directions (NEH-620) — authoring a `northeast` exit before that landed
 * would have stranded the room with no error anywhere.
 *
 * The barrow entrance sits at the far corner, so the dungeon is something a
 * player finds by exploring rather than by walking in a straight line.
 */

import type { RoomFixture } from "./types.js";

const AREA = "kingsreach-wilds";

export const WILDS_ROOMS: RoomFixture[] = [
  /* ── The crossing ─────────────────────────────────────────── */
  {
    enumKey: "WILDS_EASTBANK",
    name: "East Bank",
    description:
      "The far side of the Mindroad Bridge. The town's noise stops at the water, and what replaces " +
      "it is wind through dry grass. A rutted track runs east into open heath; the ground rises " +
      "north toward a treeline.",
    environment: "wilds-river",
    area: AREA,
    exits: {
      west: "TOWNSMEE_MINDROAD_BRIDGE",
      east: "WILDS_HEATH_WEST",
      north: "WILDS_OAKS_WEST",
    },
  },

  /* ── The heath — the southern row ─────────────────────────── */
  {
    enumKey: "WILDS_HEATH_WEST",
    name: "Heath — Western Reach",
    description:
      "Waist-high heather in every direction, broken by outcrops of pale rock. The old road is more " +
      "a suggestion than a surface here. Something has flattened a wide circle of grass to the " +
      "northeast and not come back for it.",
    environment: "wilds-heath",
    area: AREA,
    exits: {
      west: "WILDS_EASTBANK",
      east: "WILDS_HEATH_CENTRE",
      north: "WILDS_OAKS_CENTRE",
      northeast: "WILDS_CAIRN",
      northwest: "WILDS_OAKS_WEST",
    },
  },
  {
    enumKey: "WILDS_HEATH_CENTRE",
    name: "Heath — The Standing Stone",
    description:
      "A single leaning stone, twice a man's height, worn smooth on its western face. Whatever was " +
      "carved into it is long gone. The heath runs on east; a track climbs northeast toward a cairn.",
    environment: "wilds-heath",
    area: AREA,
    exits: {
      west: "WILDS_HEATH_WEST",
      east: "WILDS_HEATH_EAST",
      north: "WILDS_CAIRN",
      northeast: "WILDS_OAKS_EAST",
    },
  },
  {
    enumKey: "WILDS_HEATH_EAST",
    name: "Heath — Eastern Reach",
    description:
      "The heather thins into gravel and scrub. The hillside ahead is cut open — dressed stone, " +
      "square-edged and deliberate, half swallowed by turf. A cold draught comes out of it even in " +
      "full sun.",
    environment: "wilds-heath",
    area: AREA,
    exits: {
      west: "WILDS_HEATH_CENTRE",
      north: "WILDS_OAKS_EAST",
      northwest: "WILDS_CAIRN",
      east: "WILDS_BARROW_MOUTH",
    },
  },

  /* ── The oak belt — the northern row ──────────────────────── */
  {
    enumKey: "WILDS_OAKS_WEST",
    name: "Scrub Oaks — West",
    description:
      "Stunted oaks grow close enough here that the light goes green. The ground is soft with years " +
      "of leaf litter and holds tracks well — several sets, all of them heading east.",
    environment: "wilds-forest",
    area: AREA,
    exits: {
      south: "WILDS_EASTBANK",
      east: "WILDS_OAKS_CENTRE",
      southeast: "WILDS_HEATH_WEST",
    },
  },
  {
    enumKey: "WILDS_OAKS_CENTRE",
    name: "Scrub Oaks — The Clearing",
    description:
      "The oaks open onto a clearing with a fire-scar at its centre, cold and rain-flattened. " +
      "Someone camped here and left in a hurry: a boot, a cut strap, no pack.",
    environment: "wilds-forest",
    area: AREA,
    exits: {
      west: "WILDS_OAKS_WEST",
      east: "WILDS_OAKS_EAST",
      south: "WILDS_HEATH_WEST",
      southeast: "WILDS_CAIRN",
    },
  },
  {
    enumKey: "WILDS_OAKS_EAST",
    name: "Scrub Oaks — East Edge",
    description:
      "The treeline ends abruptly at a drop of two or three feet, as though the ground were cut " +
      "away. Below and south, the heath runs to the barrow.",
    environment: "wilds-forest",
    area: AREA,
    exits: {
      west: "WILDS_OAKS_CENTRE",
      south: "WILDS_HEATH_EAST",
      southwest: "WILDS_HEATH_CENTRE",
    },
  },

  /* ── The cairn — the middle of the lattice ────────────────── */
  {
    enumKey: "WILDS_CAIRN",
    name: "The Wolf Cairn",
    description:
      "A waist-high pile of stacked stones, added to by generations of people passing. Bones are " +
      "worked in among the rocks — canine, and not small. The cairn sits at the crossing of every " +
      "track in the wilds.",
    environment: "wilds-heath",
    area: AREA,
    exits: {
      south: "WILDS_HEATH_CENTRE",
      southwest: "WILDS_HEATH_WEST",
      southeast: "WILDS_HEATH_EAST",
      northwest: "WILDS_OAKS_CENTRE",
    },
  },

  /* ── The threshold ────────────────────────────────────────── */
  {
    enumKey: "WILDS_BARROW_MOUTH",
    name: "The Barrow Mouth",
    description:
      "Cut steps go down into the hillside between two upright slabs. The lintel across them carries " +
      "one line of text in a script nobody in Townsmee reads any more. The dark below is the " +
      "genuinely lightless kind.",
    environment: "wilds-barrow",
    area: AREA,
    exits: {
      west: "WILDS_HEATH_EAST",
      down: "BARROW_ENTRY_HALL",
    },
  },
];
