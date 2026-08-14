/**
 * Per-WebSocket session state.
 *
 * Holds the values the command processor mutates without going to
 * the database — currently which room the player is in. Phase 7
 * will persist room moves back to MudPlayer.roomId, but the
 * authoritative for-this-connection answer lives here so the next
 * `look` doesn't have to re-read from Postgres.
 *
 * One session per authenticated WebSocket. The userId comes from
 * the AUTH frame's verified JWT and never changes for the
 * connection's lifetime.
 */

/** One stack the player is carrying. */
export interface InventoryEntry {
  itemId: string;
  name: string;
  quantity: number;
  /**
   * True when the player is wearing or wielding this.
   *
   * At most one entry per SLOT may be equipped; `equip` enforces that by
   * unequipping the previous holder of that slot. It used to be one per
   * item TYPE, which meant a helmet and a shield contended for the same
   * place because all armour shares one type.
   */
  equipped?: boolean;
  /**
   * Item type — 1 weapon, 2 armour, 3 consumable, 4 lightsource, 5 misc.
   *
   * Carried on the entry so the equip rules and the combat wiring do not
   * have to reach into the world catalog for a number they need on every
   * swing. Optional because entries built before items had types (and the
   * in-memory test fixtures) simply do not have one.
   */
  type?: number;
  /**
   * Where it is equipped — "weapon", "head", "shield", … Absent means the
   * item cannot be equipped, or that the entry predates slots.
   */
  slot?: string | null;
  /** Weapon damage or armour protection, straight from the catalog. */
  baseValue?: number | null;
}

export interface SessionState {
  userId: string;
  characterName?: string;
  /** Current room (UUID). Resolved from the spawn-room enumKey at
   * session start; updated by the `move` handler. */
  currentRoomId: string;
  /** Player HP. Initialized to `maxHp` at session open; combat
   * decrements it; respawn restores it. */
  currentHp: number;
  maxHp: number;
  /** Total accumulated experience. Loaded from `mud.player` at session
   * open and written back when it changes, so it survives a reconnect. */
  experience: number;
  /**
   * Current level.
   *
   * Always `levelForXp(experience)` — kept on the session so a status line
   * or a level-up announcement does not have to recompute it, never as an
   * independent counter. If the two ever disagree, the experience is right.
   */
  level: number;
  /**
   * What the player is carrying, loaded from `mud.inventory` at session open
   * and written back when it changes.
   *
   * Held on the session rather than read per command because `inventory` and
   * `drop` both need it and a round trip per keystroke is not worth it — but
   * it is a CACHE of the rows, not the truth. The database is the record.
   */
  inventory: InventoryEntry[];
  /** True while the player has 0 HP. The combat resolver flips
   * this; the next command (typically `look`) re-spawns them at
   * the town square. */
  defeated: boolean;
  /**
   * True while the player is resting.
   *
   * Set by `rest` and cleared by anything that breaks it — moving, being
   * attacked, attacking. Held here rather than inferred from "HP below max"
   * because those are different states: a player at full HP can still be
   * sitting down, and a player who has just been ambushed is not resting no
   * matter what their HP says.
   */
  resting: boolean;
  /**
   * Character sheet, loaded once at session open.
   *
   * `statistics` is a read-only view of values that only change on level-up
   * or equipment change, so re-reading the row on every invocation would be a
   * query for data the session already has. Undefined only for sessions that
   * never loaded a player row (the in-memory tests, and the window before
   * `create <name>` completes).
   */
  sheet?: CharacterSheet;
}

/** The unchanging-per-session half of a character, shown by `statistics`. */
export interface CharacterSheet {
  /**
   * What the character was built from — one entry per axis the pack
   * declares, in the order it declares them, as `[groupName, optionName]`
   * pairs ready to render.
   *
   * A list rather than the `raceName` / `className` fields this used to
   * have, because those two names were the schema's assumption that every
   * world builds characters the same way. Empty is a valid character in a
   * pack with no creation axes.
   */
  options: Array<{ groupName: string; optionName: string }>;
  strength: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  constitution: number;
  dexterity: number;
  luck: number;
}

/**
 * Default character HP for a session with no player row behind it — the
 * in-memory tests, and the window before creation completes. A real
 * character's pool is derived from its constitution in `character.ts`.
 */
export const DEFAULT_MAX_HP = 30;

/**
 * In-memory session store keyed by the WS connection's userId.
 * Single-process so a Map is fine; Phase 8+ horizontal scaling
 * would need Redis or pgbouncer-style sticky routing.
 */
export class SessionRegistry {
  private bySocket = new WeakMap<object, SessionState>();
  private byUser = new Map<string, SessionState>();

  open(socket: object, userId: string, spawnRoomId: string): SessionState {
    const state: SessionState = {
      userId,
      currentRoomId: spawnRoomId,
      currentHp: DEFAULT_MAX_HP,
      maxHp: DEFAULT_MAX_HP,
      experience: 0,
      level: 1,
      inventory: [],
      defeated: false,
      resting: false,
    };
    this.bySocket.set(socket, state);
    this.byUser.set(userId, state);
    return state;
  }

  get(socket: object): SessionState | undefined {
    return this.bySocket.get(socket);
  }

  getByUserId(userId: string): SessionState | undefined {
    return this.byUser.get(userId);
  }

  close(socket: object): void {
    const s = this.bySocket.get(socket);
    if (s) this.byUser.delete(s.userId);
    this.bySocket.delete(socket);
  }

  size(): number {
    return this.byUser.size;
  }

  /**
   * Every live session.
   *
   * Needed because communication verbs address OTHER players — `say` reaches a
   * room, `who` reaches everyone — and until now nothing could see past the
   * caller's own session. A WeakMap keyed by socket cannot be enumerated, so
   * the by-user map is the one that answers this.
   */
  all(): SessionState[] {
    return [...this.byUser.values()];
  }

  /** Live sessions in a room, excluding one userId when given. */
  inRoom(roomId: string, excludeUserId?: string): SessionState[] {
    return this.all().filter(
      (s) => s.currentRoomId === roomId && s.userId !== excludeUserId,
    );
  }

  /**
   * Find a session by character name, case-insensitively.
   *
   * Falls back to userId so a session that has not set a name yet is still
   * addressable — otherwise a player mid-creation is invisible to `who` and
   * unreachable by `whisper`, which reads as them not existing.
   */
  findByCharacterName(name: string): SessionState | undefined {
    const q = name.trim().toLowerCase();
    if (!q) return undefined;
    return this.all().find(
      (s) =>
        s.characterName?.toLowerCase() === q || s.userId.toLowerCase() === q,
    );
  }
}
