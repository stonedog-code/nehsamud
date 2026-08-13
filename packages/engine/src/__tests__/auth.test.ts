/**
 * Port of `tests/test_hopper_auth.py` to jest. Same cases, same
 * fixtures so the wire-compat guarantee with apps/web's token
 * mint can be regression-tested across the migration.
 */

import jwt from "jsonwebtoken";

import { verifyHopperToken } from "../auth.js";

const SECRET = "test-secret-key-1234";
const AUDIENCE = "hopper-mud";

function makeToken(
  options: {
    userId?: string;
    aud?: string;
    expiresInSeconds?: number;
    secret?: string;
  } = {},
): string {
  const userId = options.userId ?? "u-1";
  const aud = options.aud ?? AUDIENCE;
  const expiresInSeconds = options.expiresInSeconds ?? 300;
  const secret = options.secret ?? SECRET;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, aud, iat: now, exp: now + expiresInSeconds },
    secret,
    { algorithm: "HS256" },
  );
}

describe("verifyHopperToken — wire-compatible JWT verification", () => {
  it("happy path: returns ok=true with the resolved userId", () => {
    const token = makeToken();
    const result = verifyHopperToken(token, { secret: SECRET });
    expect(result.ok).toBe(true);
    expect(result.userId).toBe("u-1");
    expect(result.error).toBeUndefined();
  });

  it("rejects an empty token", () => {
    const result = verifyHopperToken("", { secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("empty");
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = makeToken({ secret: "other-secret" });
    const result = verifyHopperToken(token, { secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("invalid token");
  });

  it("rejects a token with the wrong audience", () => {
    const token = makeToken({ aud: "hopper-web" });
    const result = verifyHopperToken(token, { secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("audience");
  });

  it("rejects an expired token", () => {
    const token = makeToken({ expiresInSeconds: -10 });
    const result = verifyHopperToken(token, { secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("expired");
  });

  it("rejects a token whose sub does not match expectedUserId", () => {
    const token = makeToken({ userId: "u-1" });
    const result = verifyHopperToken(token, {
      secret: SECRET,
      expectedUserId: "u-2",
    });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("mismatch");
  });

  it("accepts a token whose sub matches expectedUserId", () => {
    const token = makeToken({ userId: "u-1" });
    const result = verifyHopperToken(token, {
      secret: SECRET,
      expectedUserId: "u-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a token without a sub claim", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { aud: AUDIENCE, iat: now, exp: now + 60 },
      SECRET,
      { algorithm: "HS256" },
    );
    const result = verifyHopperToken(token, { secret: SECRET });
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("sub");
  });

  it("rejects when JWT_SECRET env is unset and no override is provided", () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const token = makeToken();
      const result = verifyHopperToken(token);
      expect(result.ok).toBe(false);
      expect(result.error ?? "").toContain("JWT_SECRET");
    } finally {
      if (original !== undefined) process.env.JWT_SECRET = original;
    }
  });
});
