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
