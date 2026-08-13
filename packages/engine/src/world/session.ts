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
  /** Accumulated experience from defeated monsters. Not persisted
   * to the DB until Phase 7. */
  experience: number;
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
}
