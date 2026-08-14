import { randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";

/**
 * Mint a token the engine will accept — for the standalone dev site only.
 *
 * HopperGuard has real accounts and mints these from a Hopper session. The
 * standalone site has no account model at all, and inventing one to play a
 * demo world would be a large amount of work in service of nothing: the
 * question this app exists to answer is "does the engine play", not "can we
 * do auth".
 *
 * So this hands out an identity to whoever asks. That is a completely
 * unacceptable thing to deploy, which is why it refuses to run in
 * production — the guard is here rather than in a runbook because a note
 * saying "don't ship this" is not a mechanism.
 *
 * A character created this way is anonymous and permanent: the userId is
 * random per request, so refreshing the page is a new person. Persisting an
 * identity across reloads needs the account model this deliberately skips
 * (NEH-630 item 2), and until then a durable character is not on offer.
 */

/** Must match the engine's audience pin in `auth.ts`. */
const AUDIENCE = "hopper-mud";
const ALGORITHM = "HS256" as const;

/** Short, because it only has to outlive one play session. */
const TTL_SECONDS = 60 * 60 * 4;

export const dynamic = "force-dynamic";

export function POST(): Response {
  if (process.env.NODE_ENV === "production" && !process.env.MUD_ALLOW_DEV_TOKENS) {
    // A dev-only credential minter reachable in production is an open door,
    // not a convenience. The escape hatch exists because the three demo
    // deployments are "production" to Next and are still demos.
    return Response.json(
      { error: "not available" },
      { status: 404 },
    );
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Named plainly: this is an operator message on an operator surface, and
    // a vague 500 here costs an hour of looking in the wrong place.
    return Response.json(
      { error: "JWT_SECRET is not set on the app, so no token can be minted" },
      { status: 500 },
    );
  }

  const userId = randomUUID();
  const token = jwt.sign({ sub: userId, aud: AUDIENCE }, secret, {
    algorithm: ALGORITHM,
    expiresIn: TTL_SECONDS,
  });

  return Response.json({ token, userId });
}
