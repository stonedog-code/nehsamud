import { normalizeDatabaseUrl } from "../index.js";

/**
 * The URL normalisation that makes the Prisma client reach a managed
 * Postgres at all.
 *
 * These are pure-string assertions on purpose: the bug they encode took
 * three separate sessions to identify precisely because reproducing it
 * needed a real RDS instance, and the symptom — `P1010: User was denied
 * access` — pointed at credentials rather than at TLS.
 */

const BASE = "postgresql://u:p@host.rds.amazonaws.com:5432/db";

const params = (url: string): URLSearchParams =>
  new URL(url).searchParams;

describe("normalizeDatabaseUrl", () => {
  it("encrypts by default when the URL says nothing", () => {
    // RDS refuses unencrypted connections at authentication, and the driver
    // reports that refusal as a permissions error.
    const out = params(normalizeDatabaseUrl(BASE));
    expect(out.get("sslmode")).toBe("require");
    expect(out.get("uselibpqcompat")).toBe("true");
  });

  it("restores libpq's meaning for sslmode=require", () => {
    // node-postgres >= 8.16 reads `require` as "verify the certificate too",
    // which fails against the RDS CA with P1011. libpq means "encrypt".
    // Someone writing `require` meant the latter.
    const out = params(normalizeDatabaseUrl(`${BASE}?sslmode=require`));
    expect(out.get("sslmode")).toBe("require");
    expect(out.get("uselibpqcompat")).toBe("true");
  });

  it("does the same for prefer and allow", () => {
    for (const mode of ["prefer", "allow"]) {
      const out = params(normalizeDatabaseUrl(`${BASE}?sslmode=${mode}`));
      expect(out.get("sslmode")).toBe(mode);
      expect(out.get("uselibpqcompat")).toBe("true");
    }
  });

  it("leaves an explicit verify-full alone", () => {
    // Someone asking for real certificate verification must get it. Adding
    // libpq compatibility here would silently downgrade them to encryption
    // without authentication — the exact opposite of what they asked for.
    const out = params(normalizeDatabaseUrl(`${BASE}?sslmode=verify-full`));
    expect(out.get("sslmode")).toBe("verify-full");
    expect(out.get("uselibpqcompat")).toBeNull();
  });

  it("leaves verify-ca and disable alone too", () => {
    for (const mode of ["verify-ca", "disable"]) {
      const out = params(normalizeDatabaseUrl(`${BASE}?sslmode=${mode}`));
      expect(out.get("sslmode")).toBe(mode);
      expect(out.get("uselibpqcompat")).toBeNull();
    }
  });

  it("never overrides an explicit uselibpqcompat", () => {
    const out = params(
      normalizeDatabaseUrl(`${BASE}?uselibpqcompat=false&sslmode=verify-full`),
    );
    expect(out.get("uselibpqcompat")).toBe("false");
    expect(out.get("sslmode")).toBe("verify-full");
  });

  it("keeps every other parameter it was given", () => {
    // `schema` in particular is load-bearing for the multi-schema setup;
    // rebuilding the URL must not drop it.
    const out = params(
      normalizeDatabaseUrl(`${BASE}?schema=public&connection_limit=5`),
    );
    expect(out.get("schema")).toBe("public");
    expect(out.get("connection_limit")).toBe("5");
    expect(out.get("sslmode")).toBe("require");
  });

  it("preserves the parts of the URL that identify the database", () => {
    const out = new URL(normalizeDatabaseUrl(BASE));
    expect(out.username).toBe("u");
    expect(out.hostname).toBe("host.rds.amazonaws.com");
    expect(out.port).toBe("5432");
    expect(out.pathname).toBe("/db");
  });

  it("hands back something unparseable untouched", () => {
    // The driver's error for a malformed URL is better than any guess made
    // here, and mangling it further would bury the real problem.
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });

  it("is idempotent", () => {
    const once = normalizeDatabaseUrl(BASE);
    expect(normalizeDatabaseUrl(once)).toBe(once);
  });
});
