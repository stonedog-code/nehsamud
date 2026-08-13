/**
 * JWT verification for the MUD AUTH frame.
 *
 * Wire-compatible with the Python implementation that this module is
 * replacing — same shared secret env var (`JWT_SECRET`), same
 * audience pin (`hopper-mud`), same minted-by apps/web at
 * `/api/mud/auth-token`. The Python side returned an `AuthResult`
 * dataclass with `ok` / `user_id` / `error`; we mirror that shape so
 * downstream callsites port 1:1 in later phases.
 *
 * Cases we explicitly reject (each test-covered):
 *   - Empty / missing token.
 *   - Wrong signing secret.
 *   - Wrong audience (e.g. an apps/web NextAuth token leaking onto
 *     the WS).
 *   - Expired token (5-minute TTL on minted tokens).
 *   - Missing `sub` claim.
 *   - `expectedUserId` mismatch (when the caller wants to bind the
 *     token to a specific Hopper user).
 *   - `JWT_SECRET` env not set on this side (deploy gap).
 *
 * Never throws — callers branch on `result.ok`.
 */

import jwt from "jsonwebtoken";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

export interface VerifyOptions {
  /** When set, the decoded `sub` claim must equal this value. */
  expectedUserId?: string;
  /** Override the shared-secret env var. Tests use this; runtime
   * code reads from `process.env.JWT_SECRET` by leaving it unset. */
  secret?: string;
}

/**
 * JWT audience pin.
 *
 * **This string is a wire contract, not a name.** HopperGuard's
 * `/api/mud/auth-token` mints tokens carrying `aud: "hopper-mud"`, so
 * renaming it here to match this package would reject every token that host
 * issues. It changes only in lockstep with the minter, and only for a reason
 * better than tidiness.
 */
const AUDIENCE = "hopper-mud";
const ALGORITHM = "HS256" as const;

export function verifyHopperToken(
  token: string,
  options: VerifyOptions = {},
): AuthResult {
  if (!token || token.length === 0) {
    return { ok: false, error: "empty token" };
  }

  const secret = options.secret ?? process.env.JWT_SECRET;
  if (!secret) {
    return {
      ok: false,
      error: "JWT_SECRET not set on this side — deploy/env gap",
    };
  }

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, {
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    if (typeof decoded === "string") {
      // jsonwebtoken returns string only when the payload itself was a
      // string at sign time — the apps/web mint uses an object payload,
      // so this branch indicates a malformed / non-spec token.
      return { ok: false, error: "invalid token: non-object payload" };
    }
    payload = decoded;
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, error: "missing sub claim" };
  }

  if (options.expectedUserId && payload.sub !== options.expectedUserId) {
    return {
      ok: false,
      error: `sub mismatch: token sub=${payload.sub} expected=${options.expectedUserId}`,
    };
  }

  return { ok: true, userId: payload.sub };
}

function classifyError(err: unknown): string {
  if (err instanceof jwt.TokenExpiredError) return "expired token";
  if (err instanceof jwt.JsonWebTokenError) {
    if (err.message.includes("audience")) return "wrong audience";
    return "invalid token";
  }
  return `verification failed: ${err instanceof Error ? err.message : String(err)}`;
}
