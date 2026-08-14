/**
 * In-memory world cache.
 *
 * Loaded once at boot from the mud.* catalog tables and held for
 * the lifetime of the process. Rooms, NPCs, items, hostiles, etc.
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
  /** Region key — see AreaFixture. Distinct from `environment`. */
  area: string;
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
  /** Pack-defined labels. The engine reads none of them; the AI dialog
   * prompt passes them through as flavour. */
  tags: string[];
  intelligenceMode: "canned" | "ai";
  dialogLines: string[];
  interests: string[];
}

/**
 * Hostile catalog row (read-only base stats). Spawned instances
 * are tracked separately as `HostileInstance`.
 */
export interface CachedHostile {
  id: string;
  slug: string;
  name: string;
  description: string;
  level: number;
  baseHp: number;
  baseDamage: number;
  experience: number;
  /** Pack-defined labels, e.g. ["undead", "evil"]. Read by no rule — they
   * classify content for the pack's own benefit. */
  tags: string[];
}

/**
 * A live hostile in a specific room. Multiple instances of the
 * same slug can coexist (e.g. two giant rats); each gets a unique
 * `instanceId` that the player can target with `attack <slug>`
 * (resolves to the first live instance of that slug in the room).
 */
export interface HostileInstance {
  instanceId: string;
  hostileId: string;
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
  /** Where it is equipped, or null when it cannot be. */
  slot: string | null;
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

/**
 * How long a defeated hostile stays gone before its spawn point refills.
 *
 * Long enough that clearing a room means something for a while, short enough
 * that a player who walks a loop finds the world alive again rather than
 * strip-mined. Levelling needs SOMETHING to fight repeatedly — a world that
 * empties permanently cannot support progression at any size (NEH-664).
 */
export const RESPAWN_DELAY_MS = 90_000;

/**
 * A place in the world that holds one hostile, and refills after a delay.
 *
 * The fixtures declared these all along; the engine just spawned from them
 * once at boot and forgot where they came from, so a kill was permanent.
 * Keeping the point means the world knows what belongs where.
 */
interface SpawnPoint {
  slug: string;
  roomId: string;
  /** The live instance standing here, when there is one. */
  instanceId?: string;
  /** When this point may refill. Undefined while it is occupied. */
  respawnAt?: number;
}

/**
 * What a defeated player leaves behind.
 *
 * A MARKER, not a container. The items themselves go onto the room floor at
 * the moment of death, where they persist in `mud.room_item` like anything
 * else dropped; this only groups them so `loot <name>` can take the lot in
 * one go instead of making the winner type `get` eleven times.
 *
 * That split is deliberate. A corpse holding the items in memory would lose
 * them all on a restart — the victim's rows are already gone by then. This
 * way a restart costs the convenience of `loot` and nothing else: the pile
 * is still on the floor and still `get`-able, one piece at a time.
 */
export interface Corpse {
  id: string;
  /** Whose it was, as other players knew them. */
  ownerName: string;
  roomId: string;
  /** What went on the floor, so `loot` knows how much of it is this pile. */
  contents: Array<{ itemId: string; name: string; quantity: number }>;
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

  /**
   * Source of the current time, injected.
   *
   * Respawn is evaluated when a player types something, not on a background
   * timer — the same choice `rest` makes, and for the same reason: a
   * command's effect stays a pure function of the state it was given, so a
   * test can assert respawn without waiting ninety seconds or mocking
   * globals. Production passes nothing and gets the clock.
   */
  private readonly now: () => number;

  constructor(mode: GameMode = DEFAULT_GAME_MODE, now: () => number = Date.now) {
    this.mode = mode;
    this.now = now;
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
  private hostiles = new Map<string, CachedHostile>();
  private hostilesBySlug = new Map<string, CachedHostile>();
  /** Live hostile instances by their opaque instanceId. */
  private hostileInstances = new Map<string, HostileInstance>();
  /** Index of live instances per roomId for fast `look` rendering. */
  private hostilesByRoomId = new Map<string, HostileInstance[]>();
  private nextHostileInstanceCounter = 0;
  /** Declared places a hostile belongs, and when each may refill. */
  private spawnPoints: SpawnPoint[] = [];
  private corpses = new Map<string, Corpse>();
  private nextCorpseCounter = 0;
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
        area: true,
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
        area: r.area,
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
        tags: true,
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
        tags: n.tags,
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

    const hostileRows = await prisma.mudHostile.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        level: true,
        baseHp: true,
        baseDamage: true,
        experience: true,
        tags: true,
      },
    });
    this.hostiles.clear();
    this.hostilesBySlug.clear();
    for (const m of hostileRows) {
      const cached: CachedHostile = {
        id: m.id,
        slug: m.slug,
        name: m.name,
        description: m.description,
        level: m.level,
        baseHp: m.baseHp,
        baseDamage: m.baseDamage,
        experience: m.experience,
        tags: m.tags,
      };
      this.hostiles.set(m.id, cached);
      this.hostilesBySlug.set(m.slug, cached);
    }
    // Live hostile instances clear on every world reload — they're
    // memory-only, not persisted, so a process restart re-spawns
    // from the spawn fixtures (which the caller wires after load).
    this.hostileInstances.clear();
    this.hostilesByRoomId.clear();
    this.nextHostileInstanceCounter = 0;
    // Spawn points go with them: they are re-registered from the pack by
    // whoever boots the world, so keeping stale ones would refill rooms
    // that may no longer exist.
    this.spawnPoints = [];
    // Corpses are markers over floor contents, and the floor is reloaded
    // below. The pile survives; the grouping does not.
    this.corpses.clear();
    this.nextCorpseCounter = 0;

    const itemRows = await prisma.mudItem.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        slot: true,
        baseValue: true,
        weight: true,
      },
    });
    this.items.clear();
    for (const i of itemRows) this.items.set(i.id, i);

    // Room contents DO persist, unlike hostile spawns — an item a player
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
    hostiles: CachedHostile[] = [],
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
    this.hostiles.clear();
    this.hostilesBySlug.clear();
    this.hostileInstances.clear();
    this.hostilesByRoomId.clear();
    this.nextHostileInstanceCounter = 0;
    this.spawnPoints = [];
    this.corpses.clear();
    this.nextCorpseCounter = 0;
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
    for (const m of hostiles) {
      this.hostiles.set(m.id, m);
      this.hostilesBySlug.set(m.slug, m);
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
   * same as hostile instances. The database is where they are loaded from and
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

  /* ─── Hostile catalog + instance management ───────────────── */

  getHostileBySlug(slug: string): CachedHostile | undefined {
    return this.hostilesBySlug.get(slug);
  }

  hostileCatalogCount(): number {
    return this.hostiles.size;
  }

  /**
   * Spawn a fresh instance of the given hostile into the given
   * room. Returns the new instance so callers can log it or hand
   * it to combat. Throws when the slug or room is unknown — the
   * caller passed bad fixture data.
   *
   * Also throws in a world whose mode has no hostiles. This is one of the
   * two independent guards behind the Exploration build's promise: callers
   * are expected to check `capabilities.hostiles` and skip, but a new call
   * site that forgets must fail loudly rather than quietly put a hostile in
   * front of someone who was told there were none.
   */
  spawnHostile(hostileSlug: string, roomId: string): HostileInstance {
    if (!this.capabilities.hostiles) {
      throw new Error(
        `spawnHostile: refused — this world runs in "${this.mode}" mode, ` +
          "which has no hostiles",
      );
    }
    const catalog = this.hostilesBySlug.get(hostileSlug);
    if (!catalog) {
      throw new Error(`spawnHostile: unknown hostile slug "${hostileSlug}"`);
    }
    if (!this.rooms.has(roomId)) {
      throw new Error(`spawnHostile: unknown roomId "${roomId}"`);
    }
    this.nextHostileInstanceCounter += 1;
    const instanceId = `${hostileSlug}-${this.nextHostileInstanceCounter}`;
    const instance: HostileInstance = {
      instanceId,
      hostileId: catalog.id,
      slug: catalog.slug,
      name: catalog.name,
      roomId,
      currentHp: catalog.baseHp,
      maxHp: catalog.baseHp,
      baseDamage: catalog.baseDamage,
      experience: catalog.experience,
    };
    this.hostileInstances.set(instanceId, instance);
    const list = this.hostilesByRoomId.get(roomId) ?? [];
    list.push(instance);
    this.hostilesByRoomId.set(roomId, list);
    return instance;
  }

  getHostilesInRoom(roomId: string): HostileInstance[] {
    return this.hostilesByRoomId.get(roomId) ?? [];
  }

  /** First live instance of the slug in the room, or by instanceId
   * match. Returns undefined when the player typed a slug that
   * isn't present. */
  findHostileInRoom(query: string, roomId: string): HostileInstance | undefined {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    const inRoom = this.getHostilesInRoom(roomId);
    return inRoom.find(
      (m) =>
        m.instanceId.toLowerCase() === needle ||
        m.slug.toLowerCase() === needle ||
        m.name.toLowerCase() === needle ||
        m.name.toLowerCase().split(" ")[0] === needle,
    );
  }

  /** Remove a defeated hostile instance from the world. */
  despawnHostile(instanceId: string): void {
    const instance = this.hostileInstances.get(instanceId);
    if (!instance) return;
    // Free the point this instance was standing in and start its clock. A
    // hostile spawned outside any declared point (a test, a future summon)
    // simply has none, and nothing refills.
    const point = this.spawnPoints.find((p) => p.instanceId === instanceId);
    if (point) {
      delete point.instanceId;
      point.respawnAt = this.now() + RESPAWN_DELAY_MS;
    }
    this.hostileInstances.delete(instanceId);
    const list = this.hostilesByRoomId.get(instance.roomId);
    if (list) {
      const filtered = list.filter((m) => m.instanceId !== instanceId);
      if (filtered.length === 0) this.hostilesByRoomId.delete(instance.roomId);
      else this.hostilesByRoomId.set(instance.roomId, filtered);
    }
  }

  /** Apply damage to a hostile instance. Returns the surviving
   * HP, or 0 if the instance was killed (and despawned). */
  damageHostile(instanceId: string, damage: number): number {
    const instance = this.hostileInstances.get(instanceId);
    if (!instance) return 0;
    instance.currentHp = Math.max(0, instance.currentHp - damage);
    if (instance.currentHp === 0) {
      this.despawnHostile(instanceId);
    }
    return instance.currentHp;
  }

  liveHostileCount(): number {
    return this.hostileInstances.size;
  }

  /* ─── Corpses ──────────────────────────────────────────────── */

  /**
   * Put a defeated player's belongings on the floor and mark the pile.
   *
   * Returns undefined when they were carrying nothing — an empty corpse is
   * a thing to `loot` that yields nothing, which reads as the mechanic being
   * broken rather than as the victim being poor.
   */
  dropCorpse(
    roomId: string,
    ownerName: string,
    items: Array<{ itemId: string; quantity: number }>,
  ): Corpse | undefined {
    const contents: Corpse["contents"] = [];
    for (const entry of items) {
      const catalog = this.items.get(entry.itemId);
      if (!catalog || entry.quantity <= 0) continue;
      this.addItemToRoom(roomId, entry.itemId, entry.quantity, false);
      contents.push({
        itemId: entry.itemId,
        name: catalog.name,
        quantity: entry.quantity,
      });
    }
    if (contents.length === 0) return undefined;
    this.nextCorpseCounter += 1;
    const corpse: Corpse = {
      id: `corpse-${this.nextCorpseCounter}`,
      ownerName,
      roomId,
      contents,
    };
    this.corpses.set(corpse.id, corpse);
    return corpse;
  }

  getCorpsesInRoom(roomId: string): Corpse[] {
    return [...this.corpses.values()].filter((c) => c.roomId === roomId);
  }

  /**
   * Find a corpse by the name of whoever it belonged to, or by its id.
   *
   * Name-first, because `loot aelric` is what a player types — they saw who
   * died, not an identifier.
   */
  findCorpseInRoom(query: string, roomId: string): Corpse | undefined {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    const here = this.getCorpsesInRoom(roomId);
    return (
      here.find((c) => c.ownerName.toLowerCase() === needle) ??
      here.find((c) => c.id.toLowerCase() === needle) ??
      here.find((c) => c.ownerName.toLowerCase().startsWith(needle))
    );
  }

  removeCorpse(id: string): void {
    this.corpses.delete(id);
  }

  corpseCount(): number {
    return this.corpses.size;
  }

  /* ─── Spawn points and respawn ─────────────────────────────── */

  /**
   * Declare that a hostile belongs here, and put one there now.
   *
   * Replaces calling `spawnHostile` directly from the boot loop, which
   * spawned from the fixtures and then forgot where they came from — so the
   * first kill emptied that place permanently and the world only ever got
   * quieter. Returns the instance, or undefined in a world with no hostiles.
   */
  registerSpawnPoint(slug: string, roomId: string): HostileInstance | undefined {
    if (!this.capabilities.hostiles) return undefined;
    const instance = this.spawnHostile(slug, roomId);
    this.spawnPoints.push({ slug, roomId, instanceId: instance.instanceId });
    return instance;
  }

  spawnPointCount(): number {
    return this.spawnPoints.length;
  }

  /**
   * Refill every spawn point whose delay has elapsed. Returns what came back.
   *
   * Called when a player acts, never on a timer. That keeps the engine's
   * most testable property intact — a command's effect is a function of the
   * state it was given — and means an idle world costs nothing.
   *
   * The consequence worth naming: time only advances for a world somebody
   * is playing. A server left alone for an hour refills on the first command
   * after it, not during the silence. For a respawn that is the behaviour
   * you want anyway; nobody was there to miss it.
   */
  respawnDue(): HostileInstance[] {
    if (!this.capabilities.hostiles) return [];
    const now = this.now();
    const returned: HostileInstance[] = [];
    for (const point of this.spawnPoints) {
      if (point.instanceId !== undefined) continue;
      if (point.respawnAt === undefined || point.respawnAt > now) continue;
      // A room or catalog entry can vanish under a point when the seed
      // prunes content. Skip rather than throw: a world missing one wolf is
      // better than a dispatch that dies mid-command.
      if (!this.rooms.has(point.roomId)) continue;
      if (!this.hostilesBySlug.has(point.slug)) continue;
      const instance = this.spawnHostile(point.slug, point.roomId);
      point.instanceId = instance.instanceId;
      delete point.respawnAt;
      returned.push(instance);
    }
    return returned;
  }
}
