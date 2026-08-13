/**
 * Monster-spawn map. Pairs a room with one of the monsters in the
 * monster catalog. The Phase 5 world bootstrap rolls one live
 * instance per spawn entry when the server boots — players who
 * walk into the room see the monster in `look` output and can
 * `attack <slug>`.
 *
 * NOT persisted to the DB. The Python codebase stored spawn rules
 * in a separate table; the focused rewrite drops the indirection
 * because the table only ever held the same content this fixture
 * declares.
 *
 * Re-spawning after a kill is deferred to a later phase — Phase 5
 * leaves a room emptied of its monster after combat ends.
 */

export interface MonsterSpawnFixture {
  /** roomEnumKey the monster spawns in. */
  roomEnumKey: string;
  /** monster.slug from the monster catalog. */
  monsterSlug: string;
}

export const MONSTER_SPAWNS: MonsterSpawnFixture[] = [
  // Lower quarter has a goblin lurking; the demo flow walks here
  // from the square via the sunroad → talentroad → ... sequence.
  // Keep the spawn list small enough that the demo doesn't get
  // overwhelmed.
  { roomEnumKey: "TOWNSMEE_LOWER_QUARTER", monsterSlug: "goblin" },
  { roomEnumKey: "TOWNSMEE_LOWER_QUARTER", monsterSlug: "giant-rat" },
  { roomEnumKey: "TOWNSMEE_MINDROAD_BRIDGE", monsterSlug: "wolf" },
  { roomEnumKey: "TOWNSMEE_TALENTROAD", monsterSlug: "bandit" },
  { roomEnumKey: "TOWNSMEE_GALLOWS", monsterSlug: "skeleton" },

  /* ── The Kingsreach Wilds (ring 1, levels 2–5) ─────────────
   *
   * Denser than the town and a level band higher, so walking east is a
   * decision rather than scenery. The cairn is the crossroads of the whole
   * lattice, so it gets the pair of wolves its description promises —
   * content that describes a threat and then does not have one is the same
   * lie as a stat preview that disagrees with the server.
   */
  { roomEnumKey: "WILDS_HEATH_WEST", monsterSlug: "wolf" },
  { roomEnumKey: "WILDS_HEATH_CENTRE", monsterSlug: "bandit" },
  { roomEnumKey: "WILDS_HEATH_EAST", monsterSlug: "wolf" },
  { roomEnumKey: "WILDS_CAIRN", monsterSlug: "wolf" },
  { roomEnumKey: "WILDS_CAIRN", monsterSlug: "wolf" },
  { roomEnumKey: "WILDS_OAKS_CENTRE", monsterSlug: "bandit" },
  { roomEnumKey: "WILDS_OAKS_EAST", monsterSlug: "skeleton" },
  { roomEnumKey: "WILDS_BARROW_MOUTH", monsterSlug: "skeleton" },

  /* ── Barrowdeep, upper (ring 2, levels 3–6) ────────────────
   *
   * Undead, with an ogre in the antechamber so the band's upper half is
   * something a player actually meets rather than a number in a fixture.
   */
  { roomEnumKey: "BARROW_ENTRY_HALL", monsterSlug: "skeleton" },
  { roomEnumKey: "BARROW_PILLARED_WAY", monsterSlug: "zombie" },
  { roomEnumKey: "BARROW_ANTECHAMBER", monsterSlug: "ogre" },
  { roomEnumKey: "BARROW_OSSUARY", monsterSlug: "zombie" },
  { roomEnumKey: "BARROW_OSSUARY", monsterSlug: "skeleton" },

  /* ── Barrowdeep, deep (ring 3, levels 5–8) ─────────────────
   *
   * What the barrow was built over. The vault holds the fire elemental the
   * warm plinth is warm from.
   */
  { roomEnumKey: "BARROW_LOWER_LANDING", monsterSlug: "ogre" },
  { roomEnumKey: "BARROW_FLOODED_GALLERY", monsterSlug: "ogre" },
  { roomEnumKey: "BARROW_CARVED_CELL", monsterSlug: "ogre" },
  { roomEnumKey: "BARROW_INNER_VAULT", monsterSlug: "fire-elemental" },
];

/**
 * Item placements — what is lying on the floor in a fresh world.
 *
 * Unlike monster spawns these ARE persisted, into `mud.room_item`, because
 * room contents outlive a process: an item a player dropped last week is
 * still there. The seed is idempotent, so it places these only when the room
 * is empty — re-running it must not quietly duplicate a sword, and must not
 * sweep up something a player left.
 *
 * Deliberately sparse. A world where every room has loot teaches players not
 * to read; a handful of placed objects makes `look` worth doing.
 */
export interface ItemPlacementFixture {
  /** roomEnumKey the item lies in. */
  roomEnumKey: string;
  /** item.name from the item catalog — the application-layer key. */
  itemName: string;
  quantity?: number;
}

export const ITEM_PLACEMENTS: ItemPlacementFixture[] = [
  // The smithy sells weapons; a stick by the door is the joke that teaches
  // `get` without handing out anything worth having.
  { roomEnumKey: "TOWNSMEE_BLACKSMITH", itemName: "Wooden Stick" },
  { roomEnumKey: "TOWNSMEE_BLACKSMITH", itemName: "Dagger" },
  // A market stall with something stackable, so `get` and `inventory` are
  // exercised against a quantity > 1 in a real world rather than only in tests.
  { roomEnumKey: "TOWNSMEE_MARKET", itemName: "Leather Helmet" },
  // Somewhere quiet, so a player who explores past the town square finds
  // something for it.
  { roomEnumKey: "TOWNSMEE_INN_THIRD", itemName: "Quarterstaff" },

  /* ── The Kingsreach Wilds ───────────────────────────────────
   *
   * Reward for going outside, and the practical kit the barrow needs. The
   * torch and lantern are placed BEFORE the dungeon on purpose: a player who
   * walks into a lightless barrow with no light has been set up to fail by
   * the map rather than by a choice they made.
   */
  { roomEnumKey: "WILDS_OAKS_CENTRE", itemName: "Torch", quantity: 2 },
  { roomEnumKey: "WILDS_OAKS_CENTRE", itemName: "Strip of Jerky" },
  { roomEnumKey: "WILDS_CAIRN", itemName: "Short Sword" },
  { roomEnumKey: "WILDS_BARROW_MOUTH", itemName: "Oil Lantern" },
  { roomEnumKey: "WILDS_EASTBANK", itemName: "Rope (50ft)" },

  /* ── Barrowdeep ─────────────────────────────────────────────
   *
   * Each dead end holds something, because a dead end that holds nothing is
   * a wasted walk. The dry alcove's pack is the one its description names —
   * prose and contents agreeing is the whole point.
   */
  { roomEnumKey: "BARROW_SIDE_CHAMBER", itemName: "Iron Key" },
  { roomEnumKey: "BARROW_OSSUARY", itemName: "Chainmail" },
  { roomEnumKey: "BARROW_CARVED_CELL", itemName: "Antidote" },
  { roomEnumKey: "BARROW_DRY_ALCOVE", itemName: "Healing Potion", quantity: 2 },
  { roomEnumKey: "BARROW_DRY_ALCOVE", itemName: "Bedroll" },
  { roomEnumKey: "BARROW_INNER_VAULT", itemName: "Maul" },
];
