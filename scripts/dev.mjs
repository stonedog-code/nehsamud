#!/usr/bin/env node
/**
 * Run the engine and the app together, in one mode.
 *
 * This is the prototyping surface: pick a mode, get a real engine process
 * and the Next.js app in front of it, and play it.
 *
 *   npm run dev:all                    # exploration (the safe default)
 *   npm run dev:all -- pve
 *   npm run dev:all -- pvp
 *
 * Deliberately a plain script rather than a `concurrently` dependency — two
 * child processes and a signal handler is the whole job, and a dev-loop
 * dependency is one more thing to keep current.
 *
 * The engine needs Postgres. `MUD_DATABASE_URL` must be exported, or the
 * engine exits at boot saying so; this script checks first so the failure
 * arrives before two processes are spawned rather than after.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODES = ["exploration", "pve", "pvp"];
const mode = process.argv[2] ?? "exploration";

if (!MODES.includes(mode)) {
  console.error(
    `[dev] "${mode}" is not a mode. Expected one of: ${MODES.join(", ")}.`,
  );
  process.exit(1);
}

if (!process.env.MUD_DATABASE_URL) {
  console.error(
    "[dev] MUD_DATABASE_URL is not set — the engine cannot boot without a\n" +
      "      Postgres connection. Export it and retry:\n\n" +
      "        export MUD_DATABASE_URL='postgresql://…'\n\n" +
      "      The app alone (preview world, no engine) runs with `npm run dev`.",
  );
  process.exit(1);
}

console.log(`[dev] starting engine + app in ${mode} mode`);

const children = [];

function start(name, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const tag = `[${name}]`;
  child.stdout.on("data", (d) => process.stdout.write(prefix(tag, d)));
  child.stderr.on("data", (d) => process.stderr.write(prefix(tag, d)));
  child.on("exit", (code, signal) => {
    // One process dying makes the pair useless, so take the other down with
    // it rather than leaving a half-running stack that looks healthy.
    if (!shuttingDown) {
      console.error(`${tag} exited (code=${code} signal=${signal}) — stopping`);
      shutdown("child-exit");
    }
  });
  children.push(child);
  return child;
}

function prefix(tag, chunk) {
  return chunk
    .toString()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `${tag} ${line}\n`)
    .join("");
}

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev] shutting down (${reason})`);
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Ports are pinned rather than inherited. `PORT` is a common thing to have
// exported — a secrets helper that injects a deployment's environment will
// set it — and Next honours it, so without this the app tries to bind
// whatever the caller happened to have and dies on EACCES for a privileged
// port. Override deliberately with NEHSAMUD_WEB_PORT.
const webPort = process.env.NEHSAMUD_WEB_PORT ?? "3000";

start("engine", "npx", ["tsx", "watch", "src/server.ts"], join(ROOT, "packages/engine"), {
  MUD_GAME_MODE: mode,
});

start("web", "npx", ["next", "dev", "--port", webPort], join(ROOT, "apps/web"), {
  NEHSAMUD_MODES: mode,
  PORT: webPort,
});
