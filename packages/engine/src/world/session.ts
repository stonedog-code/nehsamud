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
}

/**
 * Default character HP for a fresh session. Phase 7 will derive
 * this from race + class constitution mods loaded from the
 * MudPlayer row; for now everyone starts with the same pool so
 * Phase 5 combat tuning has a stable baseline.
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
