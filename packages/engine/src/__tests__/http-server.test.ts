/**
 * Verifies the /health, /metrics, /capabilities shape that
 * hopper-monitor and apps/web depend on. Phase 1 metrics still
 * report `null` for the queue depths — the test asserts the SHAPE
 * is right, not that the engine is wired up.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { createHttpApp, type MetricsSnapshot } from "../http-server.js";

interface HttpResponse {
  status: number;
  body: unknown;
}

async function get(app: ReturnType<typeof createHttpApp>, path: string): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString();
            const status = res.statusCode ?? 0;
            server.close();
            try {
              resolve({ status, body: text ? JSON.parse(text) : null });
            } catch (parseErr) {
              reject(parseErr);
            }
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

function fixedMetricsSource(): { snapshot: () => MetricsSnapshot } {
  return {
    snapshot: () => ({
      service: "mud",
      timestamp: "2026-06-01T00:00:00.000Z",
      uptimeSeconds: 42,
      connections: 0,
      queueToWorld: null,
      queueToClients: null,
    }),
  };
}

describe("HTTP sidecar — /health, /metrics, /capabilities", () => {
  const trackedKeys = [
    "LLM_API_KEY",
    "GEMINI_API_KEY",
    "IMAGE_GEN_API_KEY",
    "STABILITY_AI_KEY",
  ] as const;
  const original: Record<string, string | undefined> = {};
  beforeEach(() => {
    // The capability resolver checks both the generic name (LLM_API_KEY)
    // AND the legacy provider-specific name (GEMINI_API_KEY) — and the
    // host shell may have one or both set from a prior secrets-pull.
    // Snapshot and clear all four so test outcomes don't depend on the
    // ambient environment.
    for (const k of trackedKeys) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of trackedKeys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("/health returns 200 with the canonical shape", async () => {
    const app = createHttpApp(fixedMetricsSource());
    const res = await get(app, "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "healthy", service: "ok" });
  });

  it("/metrics returns the metrics-source snapshot verbatim", async () => {
    const app = createHttpApp(fixedMetricsSource());
    const res = await get(app, "/metrics");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      service: "mud",
      timestamp: "2026-06-01T00:00:00.000Z",
      uptimeSeconds: 42,
      connections: 0,
      queueToWorld: null,
      queueToClients: null,
    });
  });

  it("/capabilities reflects env-set keys", async () => {
    const app = createHttpApp(fixedMetricsSource());
    let res = await get(app, "/capabilities");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ textGeneration: false, imageGeneration: false });

    process.env.LLM_API_KEY = "x";
    process.env.IMAGE_GEN_API_KEY = "y";
    res = await get(app, "/capabilities");
    expect(res.body).toEqual({ textGeneration: true, imageGeneration: true });
  });
});
