/**
 * HTTP sidecar — `/health`, `/metrics`, `/capabilities`.
 *
 * Same routes as the Python Flask app the rewrite is replacing, so
 * hopper-monitor's poller and apps/web's capabilities fetch work
 * without protocol changes. Metric values that game-engine phases
 * will populate (queue depths, active connections, world tick rate)
 * are reported as `null` here until those subsystems land.
 */

import type { AddressInfo } from "node:net";
import express, { type Express, type Request, type Response } from "express";

import { currentCapabilities } from "./capabilities.js";

export interface MetricsSnapshot {
  service: "mud";
  timestamp: string;
  /** Wall-clock seconds since process start. */
  uptimeSeconds: number;
  /** Currently open authenticated WS connections. Phase 1 always
   * reports 0 from this scaffold — replaced by ws-server snapshot
   * in phase 2+. */
  connections: number | null;
  /** Queue depths the Python engine reports today. Wired up in
   * phase 4 (command processor). */
  queueToWorld: number | null;
  queueToClients: number | null;
}

export interface MetricsSource {
  snapshot(): MetricsSnapshot;
}

export function createHttpApp(metrics: MetricsSource): Express {
  const app = express();

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "healthy", service: "ok" });
  });

  app.get("/metrics", (_req: Request, res: Response) => {
    res.status(200).json(metrics.snapshot());
  });

  app.get("/capabilities", (_req: Request, res: Response) => {
    res.status(200).json(currentCapabilities());
  });

  return app;
}

export interface HttpServerHandle {
  port: number;
  close(): Promise<void>;
}

export function listenHttp(
  app: Express,
  port: number,
  host = "0.0.0.0",
): Promise<HttpServerHandle> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address() as AddressInfo | null;
      resolve({
        port: addr?.port ?? port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on("error", reject);
  });
}
