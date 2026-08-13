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
];
