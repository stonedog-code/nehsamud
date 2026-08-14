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

/**
 * Reads the world's character-creation axes, for `/character-options`.
 *
 * Optional so the Phase-1 transport tests, which build an app with no
 * database, still get `/health` and `/metrics`. Without one the endpoint
 * answers 503 rather than an empty list — "this server cannot tell you" and
 * "this world has no options" are different facts, and a picker UI that
 * confuses them renders an empty form instead of an error.
 */
export type OptionGroupSource = () => Promise<
  Array<{
    key: string;
    name: string;
    description: string;
    required: boolean;
    options: Array<{ slug: string; name: string; description: string }>;
  }>
>;

export function createHttpApp(
  metrics: MetricsSource,
  optionGroups?: OptionGroupSource,
): Express {
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

  /**
   * What a character can be built from, in this world.
   *
   * Exists because a picker UI needs the list BEFORE it opens a socket, and
   * the conversational creation flow only reveals one axis at a time. A
   * client without this has to hardcode the options — which is exactly what
   * HopperGuard's creation widget did, and its list drifted to ten races the
   * engine had never heard of (NEH-713).
   *
   * Read-only, unauthenticated, and content rather than data: it says what a
   * world offers, not anything about a player. It is the same information
   * the seed writes from the pack.
   */
  app.get("/character-options", (_req: Request, res: Response) => {
    if (!optionGroups) {
      res.status(503).json({
        error: "This server has no world loaded, so it cannot list options.",
      });
      return;
    }
    void optionGroups()
      .then((groups) => res.status(200).json({ groups }))
      .catch(() => {
        // Deliberately not the error's own text: this is unauthenticated,
        // and a database message is exactly the internal detail that must
        // never reach a stranger.
        res.status(500).json({ error: "Could not read character options." });
      });
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
