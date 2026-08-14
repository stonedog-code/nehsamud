/**
 * Phase-4 entry point for the Node MUD server.
 *
 * Boots two listeners side by side:
 *   - HTTP on `MUD_HTTP_PORT` (default 22010) for /health, /metrics,
 *     /capabilities — same routes hopper-monitor + apps/web already
 *     poll today.
 *   - WebSocket on `MUD_WS_PORT` (default 22009) for game clients.
 *     AUTH-frame-first, JWT-signed by apps/web at
 *     /api/mud/auth-token. Post-auth CLIENT_MESSAGE frames are
 *     parsed and dispatched through the Phase 4 command processor
 *     (look / move / talk / inventory / help / quit).
 *
 * Boot order:
 *   1. Connect to Postgres (initDb).
 *   2. Load the world catalog into memory (WorldState.load).
 *   3. Start the HTTP + WS listeners.
 *   4. SIGTERM/SIGINT close in parallel; the process exits cleanly.
 *
 * Lightsail's container service sends SIGTERM during deploy
 * cutover; honoring it cleanly avoids the cascading-failure
 * behavior the Python container hit on every rollout.
 */

import { createServer as createHttpServer } from "node:http";

import { createAiServices } from "./ai/factory.js";
import { disconnectDb, initDb } from "./db.js";
import { resolveGameMode } from "./game-mode.js";
import { listOptionGroups } from "./persistence/player-store.js";
import {
  createHttpApp,
  listenHttp,
  type MetricsSource,
  type MetricsSnapshot,
} from "./http-server.js";
import { initTelemetry } from "./telemetry/setup.js";
import { WorldState } from "./world/world-state.js";
import { MudWsServer } from "./ws-server.js";

const DEFAULT_HTTP_PORT = 22010;
const DEFAULT_WS_PORT = 22009;

function parsePort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name}=${raw} is not a valid port number`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const httpPort = parsePort("MUD_HTTP_PORT", DEFAULT_HTTP_PORT);
  const wsPort = parsePort("MUD_WS_PORT", DEFAULT_WS_PORT);
  const startedAt = Date.now();

  // Bring up OpenTelemetry first so any span created during boot
  // (db connect, world load) is attached to a configured provider.
  // When OTEL_ENABLED=false, the handle's tracer is a no-op.
  const telemetry = initTelemetry();

  // Resolve the mode before anything else builds a world. Throws on an
  // unrecognised value so a typo fails the deploy rather than starting a
  // world nobody chose.
  const gameMode = resolveGameMode();

  const prisma = await initDb();
  const world = new WorldState(gameMode);
  await world.load(prisma);

  // Hostiles are skipped entirely in a mode without them. `spawnHostile`
  // would refuse anyway — that is the point of having both guards — but
  // skipping here keeps the boot log honest rather than noisy.
  let hostilesSpawned = 0;
  if (world.capabilities.hostiles) {
    const { HOSTILE_SPAWNS } = await import("./seed/fixtures/index.js");
    for (const spawn of HOSTILE_SPAWNS) {
      const room = world.getRoomByEnumKey(spawn.roomEnumKey);
      if (!room) continue;
      const catalog = world.getHostileBySlug(spawn.hostileSlug);
      if (!catalog) continue;
      // A spawn POINT, not a bare spawn: the world remembers this is where
      // one belongs, so the place refills after a kill instead of emptying
      // permanently (NEH-664).
      world.registerSpawnPoint(spawn.hostileSlug, room.id);
      hostilesSpawned += 1;
    }
  }
  console.log(
    JSON.stringify({
      msg: "world loaded",
      mode: gameMode,
      rooms: world.roomCount(),
      npcs: world.npcCount(),
      hostileCatalog: world.hostileCatalogCount(),
      hostilesSpawned,
    }),
  );

  // AI services factory — returns undefined fields when the
  // corresponding LLM / image keys aren't set on this deploy.
  // Handlers fall back to canned behavior in that case.
  const ai = createAiServices();
  console.log(
    JSON.stringify({
      msg: "ai services initialized",
      text: ai.text ? "configured" : "disabled",
      image: ai.image ? "configured" : "disabled",
    }),
  );

  // WS server bound to its own HTTP server so we can also serve a
  // `/health` from the same port if a future caddy config wants
  // it; today it just owns the upgrade handshake.
  const wsHttp = createHttpServer();
  const wsServer = new MudWsServer({
    server: wsHttp,
    world,
    ai,
    prisma,
    tracer: telemetry.tracer,
  });
  await new Promise<void>((resolve, reject) => {
    wsHttp.listen(wsPort, "0.0.0.0", () => resolve());
    wsHttp.on("error", reject);
  });

  const metrics: MetricsSource = {
    snapshot(): MetricsSnapshot {
      const summary = wsServer.summary();
      return {
        service: "mud",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        connections: summary.authenticated,
        // Queue depths land later once the engine spawns real
        // worker queues (combat tick, NPC AI).
        queueToWorld: null,
        queueToClients: null,
      };
    },
  };

  // The option source is bound here rather than inside the app, so the app
  // stays constructible without a database for the transport-only tests.
  const httpApp = createHttpApp(metrics, () => listOptionGroups(prisma));
  const httpHandle = await listenHttp(httpApp, httpPort);

  console.log(
    JSON.stringify({
      msg: "hopper-mud listening",
      httpPort: httpHandle.port,
      wsPort,
      pid: process.pid,
    }),
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ msg: "shutdown", signal }));
    await Promise.allSettled([
      httpHandle.close(),
      wsServer.close(),
      new Promise<void>((resolve) => wsHttp.close(() => resolve())),
      disconnectDb(),
      telemetry.shutdown(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ msg: "boot failed", error: String(err) }));
  process.exit(1);
});
