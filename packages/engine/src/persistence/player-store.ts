/**
 * MudPlayer read/write layer.
 *
 * Loads a character on AUTH, creates one when the player has none, and
 * writes the session's mutable state back after every dispatch. Save is
 * idempotent: if nothing changed since the last save, the update still runs
 * but writes equal values.
 *
 * WHAT A CHARACTER IS BUILT FROM IS PACK DATA, NOT A SCHEMA CONSTANT.
 * This module used to read `mud.race` and `mud.class` by name, because the
 * database had exactly those two tables. It now reads whatever option groups
 * the pack declared: two for the fantasy world, possibly none for a care
 * centre, possibly three for something later. Everything below is written
 * against "a set of groups", so adding an axis is a seed change and not a
 * code change.
 */

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@nehsamud/engine-db";

import { deriveCharacter, type AttributeMods } from "../character.js";
import { levelForXp } from "../progression.js";
import type { InventoryEntry, SessionState } from "../world/session.js";

/**
 * The seven core attributes, after every chosen option's modifiers.
 *
 * Stored on the player row rather than recomputed from the choices on every
 * read, because a levelling or equipment effect will eventually change one
 * without changing any of them.
 */
export interface PlayerAttributes {
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
}

/** One axis of a character, resolved for display. */
export interface SelectedOption {
  /** Group key, e.g. "race". */
  groupKey: string;
  /** Group display name, e.g. "Race". */
  groupName: string;
  optionSlug: string;
  /** Option display name, e.g. "Human". */
  optionName: string;
}

export interface PlayerRecord {
  id: string;
  ownerId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  lives: number;
  rebirths: number;
  /**
   * What this character was built from, in the pack's declared order.
   *
   * Empty is legitimate — a pack with no character-creation axes produces
   * characters with none — so a caller rendering this must handle the empty
   * case as a valid character rather than a missing one.
   */
  options: SelectedOption[];
  attributes: PlayerAttributes;
}

/**
 * The columns a PlayerRecord needs, shared by `loadPlayer` and `createPlayer`
 * so the two can never drift into returning different shapes — the reason
 * `statistics` could show a race on one path and `undefined` on the other.
 */
const PLAYER_SELECT = {
  id: true,
  ownerId: true,
  name: true,
  roomId: true,
  currentHp: true,
  maxHp: true,
  experience: true,
  level: true,
  lives: true,
  rebirths: true,
  strength: true,
  intelligence: true,
  wisdom: true,
  charisma: true,
  constitution: true,
  dexterity: true,
  luck: true,
  options: {
    select: {
      group: { select: { key: true, name: true, position: true } },
      option: { select: { slug: true, name: true } },
    },
  },
} as const;

/** The shape PLAYER_SELECT returns. */
interface PlayerRow {
  id: string;
  ownerId: string;
  name: string;
  roomId: string | null;
  currentHp: number;
  maxHp: number;
  experience: number;
  level: number;
  lives: number;
  rebirths: number;
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
  options: Array<{
    group: { key: string; name: string; position: number };
    option: { slug: string; name: string };
  }>;
}

/** Row → PlayerRecord. The only place the relation shape is unpacked. */
function toRecord(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    roomId: row.roomId,
    currentHp: row.currentHp,
    maxHp: row.maxHp,
    experience: row.experience,
    level: row.level,
    lives: row.lives,
    rebirths: row.rebirths,
    // Sorted here rather than in the query: `position` lives on the related
    // group, and a player's handful of options is not worth an orderBy on a
    // join for. Ties break on key so the order is total — otherwise two
    // groups sharing a position render in whatever order Postgres returned,
    // and a character sheet reshuffles itself between logins.
    options: [...row.options]
      .sort(
        (a, b) =>
          a.group.position - b.group.position ||
          a.group.key.localeCompare(b.group.key),
      )
      .map((o) => ({
        groupKey: o.group.key,
        groupName: o.group.name,
        optionSlug: o.option.slug,
        optionName: o.option.name,
      })),
    attributes: {
      strength: row.strength,
      intelligence: row.intelligence,
      wisdom: row.wisdom,
      charisma: row.charisma,
      constitution: row.constitution,
      dexterity: row.dexterity,
      luck: row.luck,
    },
  };
}

/**
 * Look up the character for this owner. Returns null when the owner
 * doesn't have one yet — the caller (ws-server.ts) then runs the
 * creation flow and routes the answers through `createPlayer` below.
 */
export async function loadPlayer(
  prisma: PrismaClient,
  ownerId: string,
): Promise<PlayerRecord | null> {
  const row = await prisma.mudPlayer.findFirst({
    where: { ownerId },
    select: PLAYER_SELECT,
  });
  return row ? toRecord(row) : null;
}

/** One choice a player may make. */
export interface OptionChoice {
  slug: string;
  name: string;
  description: string;
}

/** One axis of character creation, with the choices on it. */
export interface OptionGroup {
  key: string;
  name: string;
  description: string;
  required: boolean;
  options: OptionChoice[];
}

/**
 * Every character-creation axis this world declares, in the order it asks
 * them, each with its selectable options alphabetically.
 *
 * Returns an empty array for a pack that declares none, which is a world
 * where you simply are who you are. Callers must not treat that as an
 * unseeded database — the seed reports what it wrote, and a creation flow
 * with nothing to ask should create the character.
 */
export async function listOptionGroups(
  prisma: PrismaClient,
): Promise<OptionGroup[]> {
  const groups = await prisma.mudCharacterOptionGroup.findMany({
    orderBy: [{ position: "asc" }, { key: "asc" }],
    select: {
      key: true,
      name: true,
      description: true,
      required: true,
      options: {
        where: { selectable: true },
        orderBy: { name: "asc" },
        select: { slug: true, name: true, description: true },
      },
    },
  });
  return groups;
}

/**
 * What a player picked, as groupKey → optionSlug.
 *
 * A map rather than named fields, because the axes are pack data: naming
 * them here would put the assumption this change removed straight back.
 */
export type CharacterChoice = Record<string, string>;

/** The seven modifier columns plus what is needed to validate a choice. */
const OPTION_SELECT = {
  id: true,
  slug: true,
  selectable: true,
  strengthMod: true,
  intelligenceMod: true,
  wisdomMod: true,
  charismaMod: true,
  constitutionMod: true,
  dexterityMod: true,
  luckMod: true,
} as const;

/**
 * Create a character for this owner at the given spawn room.
 *
 * Every REQUIRED group must be answered, and every answer must name a
 * selectable option in the group it was given for. There is no default and
 * no fallback: an earlier version took the alphabetically-first playable row
 * when nothing said otherwise, and because nothing ever did say otherwise,
 * every character in the database was the same race and class. A default
 * here is indistinguishable from a working selection right up until someone
 * reads the rows.
 *
 * Throws when:
 *   - The name is empty / blank.
 *   - A required group is unanswered.
 *   - An answer names an unknown, unselectable, or wrong-group option.
 *   - An answer names a group the pack does not declare.
 *   - Another character already owns the name.
 */
export async function createPlayer(
  prisma: PrismaClient,
  ownerId: string,
  name: string,
  spawnRoomId: string,
  choice: CharacterChoice,
): Promise<PlayerRecord> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("createPlayer: name is required");
  }

  const groups = await prisma.mudCharacterOptionGroup.findMany({
    select: { id: true, key: true, name: true, required: true },
  });
  const byKey = new Map(groups.map((g) => [g.key, g]));

  // An answer for a group nobody declared is a caller bug — a stale client,
  // a typo in a script — and silently dropping it would create a character
  // that is not the one that was asked for.
  for (const key of Object.keys(choice)) {
    if (!byKey.has(key)) {
      throw new Error(`createPlayer: "${key}" is not a character option group.`);
    }
  }

  const selections: Array<{ groupId: string; optionId: string }> = [];
  const mods: AttributeMods[] = [];
  for (const group of groups) {
    const slug = choice[group.key];
    if (slug === undefined || slug.trim() === "") {
      if (group.required) {
        throw new Error(`createPlayer: "${group.name}" is required.`);
      }
      continue;
    }
    // Looked up by (group, slug), not slug alone: slugs are unique only
    // within their group, so a global lookup could resolve an answer for one
    // axis against an option belonging to another.
    const option = await prisma.mudCharacterOption.findUnique({
      where: { groupId_slug: { groupId: group.id, slug } },
      select: OPTION_SELECT,
    });
    if (!option || !option.selectable) {
      throw new Error(
        `createPlayer: "${slug}" is not a selectable ${group.name}.`,
      );
    }
    selections.push({ groupId: group.id, optionId: option.id });
    mods.push(option);
  }

  // The seven attribute columns were never written, so every player took the
  // schema default of 10 across the board however they were built — and the
  // modifier columns, seeded with real numbers, were read by nothing at all.
  const { attributes, maxHp } = deriveCharacter(mods);

  const created = await prisma.mudPlayer.create({
    data: {
      ownerId,
      name: trimmed,
      roomId: spawnRoomId,
      ...attributes,
      currentHp: maxHp,
      maxHp,
      experience: 0,
      lastSeenAt: new Date(),
      // Written in the same statement as the player, so a character can
      // never exist without the choices it was built from. Two statements
      // would leave a window where a crash produces a character with no
      // race, no class and no way to tell that is what happened.
      options: { create: selections },
    },
    select: PLAYER_SELECT,
  });
  return toRecord(created);
}

/**
 * Back-compat wrapper kept for callers (Phase-7 + Phase-8 smoke
 * tests) that still expect "auto-spawn a Traveler character on
 * first call". New code should use `loadPlayer` + `createPlayer`.
 *
 * @deprecated Prefer `loadPlayer` + `createPlayer` so the user-
 * facing character-creation flow gets a chance to run.
 */
export async function loadOrCreatePlayer(
  prisma: PrismaClient,
  ownerId: string,
  spawnRoomId: string,
): Promise<PlayerRecord> {
  const existing = await loadPlayer(prisma, ownerId);
  if (existing) return existing;
  // This deprecated path has no player to ask, so it has to answer for them.
  // Stated here rather than defaulted inside createPlayer, so the one place
  // that still auto-picks is visible instead of being everyone's silent
  // behaviour. First selectable option per group, alphabetically.
  const groups = await listOptionGroups(prisma);
  const choice: CharacterChoice = {};
  for (const group of groups) {
    const first = group.options[0];
    if (!first) {
      if (group.required) {
        throw new Error(
          `loadOrCreatePlayer: no selectable option for required group "${group.name}". Run \`npm run seed\` first.`,
        );
      }
      continue;
    }
    choice[group.key] = first.slug;
  }
  return createPlayer(
    prisma,
    ownerId,
    `Traveler-${randomUUID().slice(0, 8)}`,
    spawnRoomId,
    choice,
  );
}

/**
 * Persist whatever the latest in-memory session state holds back
 * to the MudPlayer row. Always writes — no diffing yet. Bumps
 * lastSeenAt on every save so "online players" queries can rely
 * on it.
 */
export async function savePlayerState(
  prisma: PrismaClient,
  playerId: string,
  session: Pick<
    SessionState,
    "currentRoomId" | "currentHp" | "maxHp" | "experience" | "lives" | "rebirths"
  > &
    Partial<Pick<SessionState, "level">>,
): Promise<void> {
  await prisma.mudPlayer.update({
    where: { id: playerId },
    data: {
      roomId: session.currentRoomId,
      currentHp: session.currentHp,
      maxHp: session.maxHp,
      experience: session.experience,
      lives: session.lives,
      rebirths: session.rebirths,
      // Derived from experience rather than taken from the session, so the
      // column can never be written inconsistent with the XP beside it — the
      // level is a cache and this is where it gets refreshed. `level` on the
      // session is optional here only so older callers keep compiling.
      level: levelForXp(session.experience),
      lastSeenAt: new Date(),
    },
  });
}

/* ─── Inventory ────────────────────────────────────────────────────
 *
 * Split from savePlayerState because these are different tables with
 * different lifetimes: a player row is one UPDATE, an inventory is a set of
 * rows that can grow and shrink. Folding them together would mean rewriting
 * every inventory row on every movement command.
 */

/** Load a player's carried items. */
export async function loadInventory(
  prisma: PrismaClient,
  playerId: string,
): Promise<InventoryEntry[]> {
  const rows = await prisma.mudInventory.findMany({
    where: { playerId },
    select: {
      itemId: true,
      quantity: true,
      equipped: true,
      // Type and base value come from the catalog, not the inventory row —
      // they describe the ITEM, and duplicating them per player is how the
      // two drift after a balance change.
      item: { select: { name: true, type: true, slot: true, baseValue: true } },
    },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    name: r.item.name,
    quantity: r.quantity,
    equipped: r.equipped,
    type: r.item.type,
    slot: r.item.slot,
    baseValue: r.item.baseValue,
  }));
}

/**
 * Replace a player's inventory rows with the session's view.
 *
 * Delete-then-insert inside one transaction rather than diffing. An inventory
 * is a handful of rows, and a diff has to get three cases right (added,
 * removed, quantity changed) where a replace has one. The transaction is what
 * makes it safe: without it a crash between the delete and the insert loses
 * everything the player was carrying.
 */
export async function saveInventory(
  prisma: PrismaClient,
  playerId: string,
  inventory: InventoryEntry[],
): Promise<void> {
  await prisma.$transaction([
    prisma.mudInventory.deleteMany({ where: { playerId } }),
    ...inventory.map((entry) =>
      prisma.mudInventory.create({
        data: {
          playerId,
          itemId: entry.itemId,
          quantity: entry.quantity,
          // Without this, equipping something lasts exactly as long as the
          // session: the save writes `false` for every row, so the player
          // logs back in unarmed with no error anywhere to explain it.
          equipped: entry.equipped ?? false,
        },
      }),
    ),
  ]);
}

/**
 * Replace what is lying in one room.
 *
 * Room contents persist — an item dropped last week is still on that floor —
 * so this runs whenever a `get` or `drop` changes them. Scoped to the single
 * room the player is in, because rewriting every room's floor on every command
 * would be the obvious way to make this too slow to keep.
 */
export async function saveRoomItems(
  prisma: PrismaClient,
  roomId: string,
  stacks: Array<{ itemId: string; quantity: number; hidden?: boolean }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.mudRoomItem.deleteMany({ where: { roomId } }),
    ...stacks.map((s) =>
      prisma.mudRoomItem.create({
        data: {
          roomId,
          itemId: s.itemId,
          quantity: s.quantity,
          // Concealment has to survive the round trip, or anything a player
          // stashes reappears in plain sight on the next boot — which reads
          // as `hide` not working rather than as a persistence bug.
          hidden: s.hidden ?? false,
        },
      }),
    ),
  ]);
}

/* ─── PVP transfers ────────────────────────────────────────────────
 *
 * Death and looting each move a whole inventory between owners, and both do
 * it in ONE transaction. A loop of individual moves is the version that
 * duplicates a sword when it fails halfway, or destroys one — and a player
 * losing something they were carrying to a crash is the failure nobody
 * forgives, because there is no way to give it back.
 */

/** A stack as the world holds it on a floor. */
export interface FloorStack {
  itemId: string;
  quantity: number;
  hidden?: boolean;
}

/**
 * A player died: everything they carried is now on the floor.
 *
 * The victim's rows and the room's contents are written together, so there
 * is no instant at which the items exist in both places (duplication) or in
 * neither (destruction).
 */
export async function applyDeathDrop(
  prisma: PrismaClient,
  victimPlayerId: string,
  roomId: string,
  floor: FloorStack[],
): Promise<void> {
  await prisma.$transaction([
    prisma.mudInventory.deleteMany({ where: { playerId: victimPlayerId } }),
    prisma.mudRoomItem.deleteMany({ where: { roomId } }),
    ...floor.map((stack) =>
      prisma.mudRoomItem.create({
        data: {
          roomId,
          itemId: stack.itemId,
          quantity: stack.quantity,
          hidden: stack.hidden ?? false,
        },
      }),
    ),
  ]);
}

/**
 * A player's inventory and the floor they are standing on, written together.
 *
 * ONE TRANSACTION over both tables, which is what makes `loot` safe: it
 * moves a whole pile from the floor into someone's hands, and a crash
 * between the two halves would either duplicate everything or destroy it.
 * There is no way to give a player back something they were carrying.
 *
 * Used for EVERY command rather than only for looting. `get` and `drop`
 * have the same shape in miniature, and one persistence path that is always
 * atomic beats two that differ in whether they are.
 */
export async function saveInventoryAndRoom(
  prisma: PrismaClient,
  looterPlayerId: string,
  looterInventory: InventoryEntry[],
  roomId: string,
  floor: FloorStack[],
): Promise<void> {
  await prisma.$transaction([
    prisma.mudInventory.deleteMany({ where: { playerId: looterPlayerId } }),
    ...looterInventory.map((entry) =>
      prisma.mudInventory.create({
        data: {
          playerId: looterPlayerId,
          itemId: entry.itemId,
          quantity: entry.quantity,
          equipped: entry.equipped ?? false,
        },
      }),
    ),
    prisma.mudRoomItem.deleteMany({ where: { roomId } }),
    ...floor.map((stack) =>
      prisma.mudRoomItem.create({
        data: {
          roomId,
          itemId: stack.itemId,
          quantity: stack.quantity,
          hidden: stack.hidden ?? false,
        },
      }),
    ),
  ]);
}


/**
 * Re-make an existing character after its ninth death.
 *
 * Replaces its option rows and recomputes its attributes from the new
 * choices. Everything else — name, owner, experience, lives, rebirths —
 * was already settled by `applyDeath` and is written by `savePlayerState`.
 *
 * ONE TRANSACTION over `mud.player_option`, for the same reason the create
 * path is: a crash between the delete and the insert would leave a
 * character with no record of what it is, and `(player, group)` being the
 * primary key means a partial re-insert cannot even be retried cleanly.
 *
 * Validation is deliberately the same as creation's — `createPlayer` and
 * this are the only two ways options are ever set, and a rebirth that
 * accepted an option creation would refuse is a way to get a build you
 * could not otherwise have.
 */
export async function rebirthPlayer(
  prisma: PrismaClient,
  playerId: string,
  choice: CharacterChoice,
): Promise<PlayerRecord> {
  const groups = await prisma.mudCharacterOptionGroup.findMany({
    select: { id: true, key: true, name: true, required: true },
  });
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const key of Object.keys(choice)) {
    if (!byKey.has(key)) {
      throw new Error(`rebirthPlayer: "${key}" is not a character option group.`);
    }
  }

  const selections: Array<{ groupId: string; optionId: string }> = [];
  const mods: AttributeMods[] = [];
  for (const group of groups) {
    const slug = choice[group.key];
    if (slug === undefined || slug.trim() === "") {
      if (group.required) {
        throw new Error(`rebirthPlayer: "${group.name}" is required.`);
      }
      continue;
    }
    const option = await prisma.mudCharacterOption.findUnique({
      where: { groupId_slug: { groupId: group.id, slug } },
      select: OPTION_SELECT,
    });
    if (!option || !option.selectable) {
      throw new Error(`rebirthPlayer: "${slug}" is not a selectable ${group.name}.`);
    }
    selections.push({ groupId: group.id, optionId: option.id });
    mods.push(option);
  }

  const { attributes, maxHp } = deriveCharacter(mods);

  await prisma.$transaction([
    prisma.mudPlayerOption.deleteMany({ where: { playerId } }),
    ...selections.map((sel) =>
      prisma.mudPlayerOption.create({ data: { playerId, ...sel } }),
    ),
    prisma.mudPlayer.update({
      where: { id: playerId },
      data: {
        ...attributes,
        // Full health, because a reborn character standing at the HP it
        // died on would be killed again by the first thing it met.
        maxHp,
        currentHp: maxHp,
      },
    }),
  ]);

  const row = await prisma.mudPlayer.findUniqueOrThrow({
    where: { id: playerId },
    select: PLAYER_SELECT,
  });
  return toRecord(row);
}
