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

/* ── Loopback is not a network hop (NEH-710) ────────────────────── */

describe("loopback hosts", () => {
  // The regression that failed production deployments 641 and 642. The
  // engine runs as a sidecar beside pgbouncer on localhost, which
  // terminates no TLS — so demanding it meant the container could not boot,
  // and Lightsail rolled the deployment back before anyone read the log.
  const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

  it.each(LOOPBACK)("leaves %s alone when no sslmode is stated", (host) => {
    const url = `postgresql://u:p@${host}:6432/db?pgbouncer=true`;
    const out = normalizeDatabaseUrl(url);
    expect(out).not.toContain("sslmode");
    expect(out).not.toContain("uselibpqcompat");
  });

  it("preserves the exact URL HopperGuard's deploy generates", () => {
    // Byte-for-byte the string that broke it, so a future change to the
    // parameter handling cannot quietly reintroduce the failure.
    const url =
      "postgresql://u:p@localhost:6432/elderlink-db?connection_limit=5&pool_timeout=30&pgbouncer=true";
    const out = normalizeDatabaseUrl(url);
    expect(out).not.toMatch(/sslmode/);
    expect(out).toContain("pgbouncer=true");
    expect(out).toContain("connection_limit=5");
  });

  it.each(LOOPBACK)("still honours an explicit sslmode on %s", (host) => {
    // The exemption governs only the unstated case. An operator who asks
    // for TLS against localhost gets it.
    const out = normalizeDatabaseUrl(
      `postgresql://u:p@${host}:5432/db?sslmode=require`,
    );
    expect(out).toContain("sslmode=require");
  });

  it("does NOT exempt a host that merely looks local", () => {
    // `localhost.example.com` and `127.0.0.1.nip.io` resolve elsewhere. A
    // prefix or substring test would hand them plaintext.
    for (const host of ["localhost.example.com", "127.0.0.1.nip.io", "mylocalhost"]) {
      expect(normalizeDatabaseUrl(`postgresql://u:p@${host}:5432/db`)).toContain(
        "sslmode=require",
      );
    }
  });

  it("still encrypts a managed host when nothing is stated", () => {
    // The NEH-663 behaviour, pinned. Narrowing the default must not undo
    // the fix that introduced it — against RDS this is what stops every
    // query failing with a misleading P1010.
    const out = normalizeDatabaseUrl(
      "postgresql://u:p@ls-d9a45.chk08w46elwo.us-west-2.rds.amazonaws.com:5432/elderlink-db",
    );
    expect(out).toContain("sslmode=require");
    expect(out).toContain("uselibpqcompat=true");
  });
});
