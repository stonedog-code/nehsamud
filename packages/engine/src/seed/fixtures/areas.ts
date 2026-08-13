/**
 * Areas — the named regions the map is divided into.
 *
 * Until this existed, every room carried `environment: "townsmee"` and that
 * bare string was doing double duty: it was the region name, the art hint,
 * and the only grouping anything could key on. There was exactly one value,
 * so nothing had to distinguish those roles.
 *
 * An area is content, not mechanics. It supplies a name, prose, and a
 * *declared* difficulty band — the engine reads the band to place spawns and
 * to check that difficulty rises outward, but nothing here invents a rule.
 * That keeps this file on the pack side of the line PRD-0002 draws
 * (NEH-650): a pack supplies nouns and prose, the engine owns verbs and
 * rules.
 *
 * `environment` stays on the room, unchanged, because it drives room-art
 * generation and is a per-room hint rather than a per-region one — two rooms
 * in one area can look nothing alike.
 */

export interface AreaFixture {
  /** Stable application key, referenced by `RoomFixture.area`. */
  key: string;
  name: string;
  description: string;
  /**
   * Lowest and highest monster level the area is built for.
   *
   * Declared rather than derived so a test can assert the spawn tables
   * actually match the promise. A band that says 5–8 with a level-1 rat in
   * it is a content bug, and without the declaration there is nothing to
   * check it against.
   */
  minLevel: number;
  maxLevel: number;
  /**
   * How many rooms out from the starting area this sits.
   *
   * 0 is the town. The ordering is what "difficulty scales outward" means
   * concretely, and a test asserts the bands never go backwards as this
   * rises — otherwise "outward" is a claim in a comment rather than a
   * property of the map.
   */
  ring: number;
}

export const AREAS: AreaFixture[] = [
  {
    key: "townsmee",
    name: "Townsmee",
    description:
      "A walled market town on the sunroad. Safe, crowded, and the last place " +
      "anyone will sell you rope before the bridge.",
    minLevel: 1,
    maxLevel: 3,
    ring: 0,
  },
  {
    key: "kingsreach-wilds",
    name: "The Kingsreach Wilds",
    description:
      "Open country east of the river — heath, scrub oak, and the remains of a " +
      "road nobody has maintained in two generations. Wolves work it in pairs.",
    minLevel: 2,
    maxLevel: 5,
    ring: 1,
  },
  {
    key: "barrowdeep-upper",
    name: "Barrowdeep — The Barrow",
    description:
      "A cut-stone barrow driven into the hillside at the far edge of the wilds. " +
      "Whatever it was built to keep in has had a long time to get used to the dark.",
    minLevel: 3,
    maxLevel: 6,
    ring: 2,
  },
  {
    // Split from the barrow rather than banded 5–8 as one area. The
    // level-band test caught the original: the upper level is undead around
    // level 3 and the lower level is what the barrow was built over, and one
    // band cannot honestly describe both. The content already had two
    // distinct floors — the areas now say so.
    key: "barrowdeep-deep",
    name: "Barrowdeep — The Deep",
    description:
      "Below the barrow proper, in older and rougher stone. The builders above " +
      "were not the first to dig here, and did not go this far down by choice.",
    minLevel: 5,
    maxLevel: 8,
    ring: 3,
  },
];

/** Look an area up by key. */
export function findArea(key: string): AreaFixture | undefined {
  return AREAS.find((area) => area.key === key);
}
