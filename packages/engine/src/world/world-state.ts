/**
 * In-memory world cache.
 *
 * Loaded once at boot from the mud.* catalog tables and held for
 * the lifetime of the process. Rooms, NPCs, items, monsters, etc.
 * are catalog data (read-mostly during runtime), so caching them
 * keeps the command processor O(1) per lookup and avoids hammering
 * Postgres for descriptions on every `look`.
 *
 * Phase 4 surface — just the lookups the command handlers need:
 *   - getRoom(roomId)         current-room render for `look` / `move`
 *   - getRoomByEnumKey(key)   spawn-room lookup at session start
 *   - getNpcsInRoom(roomId)   show NPCs in `look` + resolve `talk`
 *   - getNpcBySlug(slug)      fallback resolution by stable key
 *
 * Persistence-side mutations (inventory pickup, item drop, room
 * art generation) bypass this cache and call Prisma directly. The
 * cache exists purely to make read-heavy command handlers fast.
 */

import type { PrismaClient } from "@nehsamud/engine-db";

import {
  DEFAULT_GAME_MODE,
  capabilitiesFor,
  type GameMode,
  type ModeCapabilities,
} from "../game-mode.js";

export interface CachedRoom {
  id: string;
  enumKey: string;
  name: string;
  description: string;
  /** direction → roomId map. Already resolved from enumKey at
   * seed time, so the command processor just looks the value up. */
  exits: Record<string, string>;
  environment: string | null;
  imageName: string | null;
}

export interface CachedNpc {
  id: string;
  slug: string;
  name: string;
  description: string;
  roomId: string | null;
  pronoun: string;
  alignment: string;
  intelligenceMode: "canned" | "ai";
  dialogLines: string[];
  interests: string[];
}

/**
 * Monster catalog row (read-only base stats). Spawned instances
 * are tracked separately as `MonsterInstance`.
 */
export interface CachedMonster {
  id: string;
  slug: string;
  name: string;
  description: string;
  level: number;
  baseHp: number;
  baseDamage: number;
  experience: number;
  alignment: string;
  mobType: string;
}

/**
 * A live monster in a specific room. Multiple instances of the
 * same slug can coexist (e.g. two giant rats); each gets a unique
 * `instanceId` that the player can target with `attack <slug>`
 * (resolves to the first live instance of that slug in the room).
 */
export interface MonsterInstance {
  instanceId: string;
  monsterId: string;
  slug: string;
  name: string;
  roomId: string;
  currentHp: number;
  maxHp: number;
  /** Snapshot of the catalog's baseDamage at spawn — a future
   * debuff could mutate this without losing the original. */
  baseDamage: number;
  /** Awarded to the player on kill. */
  experience: number;
}

/** Catalog row for an item. Immutable reference data. */
export interface CachedItem {
  id: string;
  name: string;
  description: string;
  /** Mirrors MudItemType. Weapons/armour interpret baseValue. */
  type: number;
  baseValue: number | null;
  weight: number;
}

/** A stack of one item lying in a room. */
export interface RoomItemStack {
  itemId: string;
  name: string;
  quantity: number;
  /**
   * Concealed from `look`; only `search` reveals it.
   *
   * Part of the stack IDENTITY, not a property of it: a hidden stack and a
   * visible stack of the same item in the same room are two stacks. Merging
   * them would mean stashing one coin conceals the whole pile, and revealing
   * one would produce coins nobody hid.
   */
  hidden: boolean;
}

export class WorldState {
  /**
   * The mode this world runs in. Set once at construction and never
   * mutated — the command context carries the world, so every handler
   * reaches the mode through it and none of them can be invoked without
   * one. Defaults to the most restrictive mode so a world built without an
   * explicit choice is the safe one.
   */
  readonly mode: GameMode;

  constructor(mode: GameMode = DEFAULT_GAME_MODE) {
    this.mode = mode;
  }

  /** What this world permits. Derived from {@link mode}. */
  get capabilities(): ModeCapabilities {
    return capabilitiesFor(this.mode);
  }

  private rooms = new Map<string, CachedRoom>();
  private roomsByEnumKey = new Map<string, CachedRoom>();
  private npcs = new Map<string, CachedNpc>();
  private npcsBySlug = new Map<string, CachedNpc>();
  private npcsByRoomId = new Map<string, CachedNpc[]>();
  private monsters = new Map<string, CachedMonster>();
  private monstersBySlug = new Map<string, CachedMonster>();
  /** Live monster instances by their opaque instanceId. */
  private monsterInstances = new Map<string, MonsterInstance>();
  /** Index of live instances per roomId for fast `look` rendering. */
  private monstersByRoomId = new Map<string, MonsterInstance[]>();
  private nextMonsterInstanceCounter = 0;
  private items = new Map<string, CachedItem>();
  /** Items lying on the floor, per room. Mutable: `get` and `drop` move
   * stacks between here and a player's inventory. */
  private roomItems = new Map<string, RoomItemStack[]>();

  async load(prisma: PrismaClient): Promise<void> {
    const rows = await prisma.mudRoom.findMany({
      select: {
        id: true,
        enumKey: true,
        name: true,
        description: true,
        exits: true,
        environment: true,
        imageName: true,
      },
    });
    this.rooms.clear();
    this.roomsByEnumKey.clear();
    for (const r of rows) {
      // Prisma returns Json as `unknown`; the seed writes a flat
      // Record<string, string> so the cast is safe at the
      // application layer's contract.
      const exits =
        typeof r.exits === "object" && r.exits !== null
          ? (r.exits as Record<string, string>)
          : {};
      const cached: CachedRoom = {
        id: r.id,
        enumKey: r.enumKey,
        name: r.name,
        description: r.description,
        exits,
        environment: r.environment,
        imageName: r.imageName,
      };
      this.rooms.set(r.id, cached);
      this.roomsByEnumKey.set(r.enumKey, cached);
    }

    const npcRows = await prisma.mudNpc.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        roomId: true,
        pronoun: true,
        alignment: true,
        intelligenceMode: true,
        dialogLines: true,
        interests: true,
      },
    });
    this.npcs.clear();
    this.npcsBySlug.clear();
    this.npcsByRoomId.clear();
    for (const n of npcRows) {
      const cached: CachedNpc = {
        id: n.id,
        slug: n.slug,
        name: n.name,
        description: n.description,
        roomId: n.roomId,
        pronoun: n.pronoun,
        alignment: n.alignment,
        intelligenceMode: n.intelligenceMode === "ai" ? "ai" : "canned",
        dialogLines: n.dialogLines,
        interests: n.interests,
      };
      this.npcs.set(n.id, cached);
      this.npcsBySlug.set(n.slug, cached);
      if (n.roomId) {
        const list = this.npcsByRoomId.get(n.roomId) ?? [];
        list.push(cached);
        this.npcsByRoomId.set(n.roomId, list);
      }
    }

    const monsterRows = await prisma.mudMonster.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        level: true,
        baseHp: true,
        baseDamage: true,
        experience: true,
        alignment: true,
        mobType: true,
      },
    });
    this.monsters.clear();
    this.monstersBySlug.clear();
    for (const m of monsterRows) {
      const cached: CachedMonster = {
        id: m.id,
        slug: m.slug,
        name: m.name,
        description: m.description,
        level: m.level,
        baseHp: m.baseHp,
        baseDamage: m.baseDamage,
        experience: m.experience,
        alignment: m.alignment,
        mobType: m.mobType,
      };
      this.monsters.set(m.id, cached);
      this.monstersBySlug.set(m.slug, cached);
    }
    // Live monster instances clear on every world reload — they're
    // memory-only, not persisted, so a process restart re-spawns
    // from the spawn fixtures (which the caller wires after load).
    this.monsterInstances.clear();
    this.monstersByRoomId.clear();
    this.nextMonsterInstanceCounter = 0;

    const itemRows = await prisma.mudItem.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        baseValue: true,
        weight: true,
      },
    });
    this.items.clear();
    for (const i of itemRows) this.items.set(i.id, i);

    // Room contents DO persist, unlike monster spawns — an item a player
    // dropped last week is still on that floor. So they are loaded rather
    // than regenerated, and written back when they move.
    const roomItemRows = await prisma.mudRoomItem.findMany({
      select: { roomId: true, itemId: true, quantity: true, hidden: true },
    });
    this.roomItems.clear();
    for (const ri of roomItemRows) {
      // Skip rows whose item vanished from the catalog rather than throwing:
      // a half-loaded world is worse than a world missing one object, and the
      // boot should not die on stale data it can simply ignore.
      if (this.items.has(ri.itemId)) {
        this.addItemToRoom(ri.roomId, ri.itemId, ri.quantity, ri.hidden);
      }
    }
  }

  /** Test seam — populate the cache without hitting the DB. */
  hydrate(
    rooms: CachedRoom[],
    npcs: CachedNpc[] = [],
    monsters: CachedMonster[] = [],
    items: CachedItem[] = [],
    roomItems: Array<{
      roomId: string;
      itemId: string;
      quantity: number;
      hidden?: boolean;
    }> = [],
  ): void {
    this.rooms.clear();
    this.roomsByEnumKey.clear();
    this.npcs.clear();
    this.npcsBySlug.clear();
    this.npcsByRoomId.clear();
    this.monsters.clear();
    this.monstersBySlug.clear();
    this.monsterInstances.clear();
    this.monstersByRoomId.clear();
    this.nextMonsterInstanceCounter = 0;
    this.items.clear();
    this.roomItems.clear();
    for (const i of items) this.items.set(i.id, i);
    for (const ri of roomItems)
      this.addItemToRoom(ri.roomId, ri.itemId, ri.quantity, ri.hidden ?? false);
    for (const r of rooms) {
      this.rooms.set(r.id, r);
      this.roomsByEnumKey.set(r.enumKey, r);
    }
    for (const n of npcs) {
      this.npcs.set(n.id, n);
      this.npcsBySlug.set(n.slug, n);
      if (n.roomId) {
        const list = this.npcsByRoomId.get(n.roomId) ?? [];
        list.push(n);
        this.npcsByRoomId.set(n.roomId, list);
      }
    }
    for (const m of monsters) {
      this.monsters.set(m.id, m);
      this.monstersBySlug.set(m.slug, m);
    }
  }

  getRoom(roomId: string): CachedRoom | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByEnumKey(enumKey: string): CachedRoom | undefined {
    return this.roomsByEnumKey.get(enumKey);
  }

  getNpcsInRoom(roomId: string): CachedNpc[] {
    return this.npcsByRoomId.get(roomId) ?? [];
  }

  getNpcBySlug(slug: string): CachedNpc | undefined {
    return this.npcsBySlug.get(slug);
  }

  /** Resolve an NPC by either its stable slug or its display name
   * (case-insensitive). The command processor accepts both so a
   * player can `talk zofia` or `talk Zofia`. */
  findNpcByName(query: string, roomId?: string): CachedNpc | undefined {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    const candidates = roomId ? this.getNpcsInRoom(roomId) : Array.from(this.npcs.values());
    return candidates.find(
      (n) =>
        n.slug.toLowerCase() === needle ||
        n.name.toLowerCase() === needle ||
        n.name.toLowerCase().split(" ")[0] === needle,
    );
  }

  roomCount(): number {
    return this.rooms.size;
  }

  npcCount(): number {
    return this.npcs.size;
  }


  /* ─── Items ────────────────────────────────────────────────────
   *
   * Room contents are IN-MEMORY and authoritative for the running world, the
   * same as monster instances. The database is where they are loaded from and
   * written back to; it is not consulted per command, because two players in
   * one room racing for one item must be resolved by a single owner and that
   * owner is this process.
   */

  getItem(itemId: string): CachedItem | undefined {
    return this.items.get(itemId);
  }

  itemCatalogCount(): number {
    return this.items.size;
  }

  /**
   * Stacks lying VISIBLY in a room. Empty array when none — never undefined,
   * so callers do not each invent a fallback.
   *
   * Visible-only by default, deliberately. Every existing caller — `look`,
   * `get`, the room render — wants what a player can see, so the safe answer
   * is the default one. A hidden item that leaked into `look` because a
   * caller forgot to filter is a mechanic that silently does nothing.
   */
  getItemsInRoom(roomId: string): RoomItemStack[] {
    return (this.roomItems.get(roomId) ?? []).filter((s) => !s.hidden);
  }

  /** Stacks concealed in a room. Only `search` should call this. */
  getHiddenItemsInRoom(roomId: string): RoomItemStack[] {
    return (this.roomItems.get(roomId) ?? []).filter((s) => s.hidden);
  }

  /** Every stack in a room, hidden or not. For persistence, which must write
   * back what it loaded rather than only the half a player can see. */
  getAllItemsInRoom(roomId: string): RoomItemStack[] {
    return this.roomItems.get(roomId) ?? [];
  }

  /**
   * Find an item in a room by name or a leading word of it, case-insensitively
   * — `get rusty` should find "Rusty Dagger", because a player types what they
   * see rather than an exact string.
   */
  findItemInRoom(
    query: string,
    roomId: string,
    opts: { hidden?: boolean } = {},
  ): RoomItemStack | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const stacks = opts.hidden
      ? this.getHiddenItemsInRoom(roomId)
      : this.getItemsInRoom(roomId);
    return (
      stacks.find((s) => s.name.toLowerCase() === q) ??
      stacks.find((s) => s.name.toLowerCase().startsWith(q)) ??
      stacks.find((s) => s.name.toLowerCase().includes(q))
    );
  }

  /**
   * Put `quantity` of an item into a room, merging into an existing stack of
   * the same visibility.
   *
   * Merging is keyed on (itemId, hidden), not itemId alone — see the note on
   * `RoomItemStack.hidden`.
   */
  addItemToRoom(
    roomId: string,
    itemId: string,
    quantity = 1,
    hidden = false,
  ): void {
    if (quantity <= 0) return;
    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`addItemToRoom: unknown itemId "${itemId}"`);
    }
    const stacks = this.roomItems.get(roomId) ?? [];
    const existing = stacks.find(
      (s) => s.itemId === itemId && s.hidden === hidden,
    );
    if (existing) {
      existing.quantity += quantity;
    } else {
      stacks.push({ itemId, name: item.name, quantity, hidden });
    }
    this.roomItems.set(roomId, stacks);
  }

  /**
   * Reveal everything concealed in a room, merging each stack into its
   * visible counterpart. Returns the names revealed, in the order found.
   *
   * All-or-nothing per room rather than one item per `search`: a player who
   * has already searched successfully should not have to keep typing it to
   * drain a room one object at a time.
   */
  revealHiddenItems(roomId: string): string[] {
    const stacks = this.roomItems.get(roomId);
    if (!stacks) return [];
    const revealed = stacks.filter((s) => s.hidden);
    if (revealed.length === 0) return [];

    const names: string[] = [];
    for (const stack of revealed) {
      names.push(stack.name);
      const index = stacks.indexOf(stack);
      stacks.splice(index, 1);
      // Re-add rather than flipping the flag in place, so a revealed stack
      // merges with one already lying in the open instead of sitting beside
      // it as a duplicate line in `look`.
      this.addItemToRoom(roomId, stack.itemId, stack.quantity, false);
    }
    return names;
  }

  /**
   * Remove one of an item from a room. Returns the stack as it was BEFORE the
   * removal, or undefined when there was none.
   *
   * Takes one at a time deliberately: `get coins` picking up an entire stack
   * silently is the kind of thing a player notices only after it is gone.
   * Empty stacks are dropped rather than left at zero, so `look` never
   * advertises something that is not there.
   */
  takeItemFromRoom(
    roomId: string,
    itemId: string,
    hidden = false,
  ): RoomItemStack | undefined {
    const stacks = this.roomItems.get(roomId);
    if (!stacks) return undefined;
    const index = stacks.findIndex(
      (s) => s.itemId === itemId && s.hidden === hidden,
    );
    if (index === -1) return undefined;
    const stack = stacks[index]!;
    const before = { ...stack };
    stack.quantity -= 1;
    if (stack.quantity <= 0) stacks.splice(index, 1);
    if (stacks.length === 0) this.roomItems.delete(roomId);
    return before;
  }

  /* ─── Monster catalog + instance management ───────────────── */

  getMonsterBySlug(slug: string): CachedMonster | undefined {
    return this.monstersBySlug.get(slug);
  }

  monsterCatalogCount(): number {
    return this.monsters.size;
  }

  /**
   * Spawn a fresh instance of the given monster into the given
   * room. Returns the new instance so callers can log it or hand
   * it to combat. Throws when the slug or room is unknown — the
   * caller passed bad fixture data.
   *
   * Also throws in a world whose mode has no monsters. This is one of the
   * two independent guards behind the Exploration build's promise: callers
   * are expected to check `capabilities.monsters` and skip, but a new call
   * site that forgets must fail loudly rather than quietly put a monster in
   * front of someone who was told there were none.
   */
  spawnMonster(monsterSlug: string, roomId: string): MonsterInstance {
    if (!this.capabilities.monsters) {
      throw new Error(
        `spawnMonster: refused — this world runs in "${this.mode}" mode, ` +
          "which has no monsters",
      );
    }
    const catalog = this.monstersBySlug.get(monsterSlug);
    if (!catalog) {
      throw new Error(`spawnMonster: unknown monster slug "${monsterSlug}"`);
    }
    if (!this.rooms.has(roomId)) {
      throw new Error(`spawnMonster: unknown roomId "${roomId}"`);
    }
    this.nextMonsterInstanceCounter += 1;
    const instanceId = `${monsterSlug}-${this.nextMonsterInstanceCounter}`;
    const instance: MonsterInstance = {
      instanceId,
      monsterId: catalog.id,
      slug: catalog.slug,
      name: catalog.name,
      roomId,
      currentHp: catalog.baseHp,
      maxHp: catalog.baseHp,
      baseDamage: catalog.baseDamage,
      experience: catalog.experience,
    };
    this.monsterInstances.set(instanceId, instance);
    const list = this.monstersByRoomId.get(roomId) ?? [];
    list.push(instance);
    this.monstersByRoomId.set(roomId, list);
    return instance;
  }

  getMonstersInRoom(roomId: string): MonsterInstance[] {
    return this.monstersByRoomId.get(roomId) ?? [];
  }

  /** First live instance of the slug in the room, or by instanceId
   * match. Returns undefined when the player typed a slug that
   * isn't present. */
  findMonsterInRoom(query: string, roomId: string): MonsterInstance | undefined {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    const inRoom = this.getMonstersInRoom(roomId);
    return inRoom.find(
      (m) =>
        m.instanceId.toLowerCase() === needle ||
        m.slug.toLowerCase() === needle ||
        m.name.toLowerCase() === needle ||
        m.name.toLowerCase().split(" ")[0] === needle,
    );
  }

  /** Remove a defeated monster instance from the world. */
  despawnMonster(instanceId: string): void {
    const instance = this.monsterInstances.get(instanceId);
    if (!instance) return;
    this.monsterInstances.delete(instanceId);
    const list = this.monstersByRoomId.get(instance.roomId);
    if (list) {
      const filtered = list.filter((m) => m.instanceId !== instanceId);
      if (filtered.length === 0) this.monstersByRoomId.delete(instance.roomId);
      else this.monstersByRoomId.set(instance.roomId, filtered);
    }
  }

  /** Apply damage to a monster instance. Returns the surviving
   * HP, or 0 if the instance was killed (and despawned). */
  damageMonster(instanceId: string, damage: number): number {
    const instance = this.monsterInstances.get(instanceId);
    if (!instance) return 0;
    instance.currentHp = Math.max(0, instance.currentHp - damage);
    if (instance.currentHp === 0) {
      this.despawnMonster(instanceId);
    }
    return instance.currentHp;
  }

  liveMonsterCount(): number {
    return this.monsterInstances.size;
  }
}
