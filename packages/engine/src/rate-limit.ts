/**
 * How fast one connection may issue commands.
 *
 * PRD-0001 R21/R22, and the half of them that survives contact with a
 * third-party client.
 *
 * THE BUDGET IN `ScriptRunner` IS NOT A DEFENCE. It is a good one against
 * the scripts it runs — but scripting is client-side (OQ1), so a script
 * written in C# or Python does not use it. Such a client opens the same
 * WebSocket everyone else does and sends `CLIENT_MESSAGE` frames as fast as
 * it likes. Anything that protects other players from that has to live
 * HERE, on the server, where no client can opt out of it.
 *
 * A TOKEN BUCKET, not a fixed window. A fixed window lets a client send its
 * whole allowance in the last millisecond of one window and again in the
 * first of the next — double the intended rate, at the worst moment. A
 * bucket refills continuously, so the sustained rate is the rate.
 *
 * The burst matters as much as the rate. A person typing does not produce a
 * steady stream: they read for ten seconds and then fire four commands. A
 * limiter tuned to the average would refuse exactly that, which is why the
 * bucket holds more than one second's worth.
 */

/** Commands per second a connection may sustain indefinitely. */
export const COMMANDS_PER_SECOND = 5;

/**
 * Commands that may be spent at once after a quiet period.
 *
 * Generous on purpose. A player reading a room description for ten seconds
 * then firing a burst is normal, and a limiter that punishes it reads as
 * lag rather than as a rule.
 */
export const BURST_CAPACITY = 20;

export interface RateLimitDecision {
  /** Whether the command may proceed. */
  allowed: boolean;
  /** Whole seconds until at least one command is possible. 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * What a throttled client is told.
 *
 * Plain, and deliberately not apologetic — a script hitting this is
 * misbehaving, and a person hitting it has almost certainly stuck a key.
 * It says the rate rather than a bare refusal so an author can fix it.
 */
export function throttleMessage(retryAfterSeconds: number): string {
  return (
    `You are sending commands too quickly. The limit is ${COMMANDS_PER_SECOND} per second. ` +
    `Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`
  );
}

/**
 * One bucket per connection.
 *
 * Deliberately per-CONNECTION rather than per-account: an account is not
 * the thing consuming the server's attention, a socket is, and keying on
 * the account would let one player open ten sockets for ten times the rate.
 */
export class RateLimiter {
  private readonly capacity: number;
  private readonly perSecond: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;

  constructor(
    opts: {
      capacity?: number;
      perSecond?: number;
      /** Injected so the refill is testable without waiting for a clock. */
      now?: () => number;
    } = {},
  ) {
    this.capacity = opts.capacity ?? BURST_CAPACITY;
    this.perSecond = opts.perSecond ?? COMMANDS_PER_SECOND;
    this.now = opts.now ?? Date.now;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  /** Tokens available right now, for tests and for reporting. */
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Take one token if there is one.
   *
   * Called once per command. Refuses rather than queues: holding a command
   * to replay later would mean a burst of movement arriving after the
   * player had given up and typed something else.
   */
  take(): RateLimitDecision {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const needed = 1 - this.tokens;
    return {
      allowed: false,
      // Rounded UP, so a client obeying the number always succeeds. Telling
      // someone to retry in 0 seconds when they cannot is how a limiter
      // turns into a hot loop.
      retryAfterSeconds: Math.max(1, Math.ceil(needed / this.perSecond)),
    };
  }

  private refill(): void {
    const now = this.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
  }
}
