import { STARTING_LIVES } from "../progression.js";
/**
 * Game modes — the Exploration build's safety property.
 *
 * The claim under test is narrow and worth stating plainly: in a world whose
 * mode is `exploration`, there is no way to reach combat. Not "the verb is
 * undocumented", not "the UI hides the button" — the hostile cannot be
 * created, the handler is not in the table, and no combat span is opened.
 *
 * Each of those is asserted separately, because they are independent guards
 * and a change that removes one while leaving the other would otherwise go
 * unnoticed.
 */

import { trace, type Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { createRng } from "../combat.js";
import {
  NO_COMBAT_MESSAGE,
  dispatch,
  handlersFor,
} from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import {
  COMBAT_VERBS,
  DEFAULT_GAME_MODE,
  GAME_MODES,
  GAME_MODE_ENV,
  MODE_CAPABILITIES,
  capabilitiesFor,
  isGameMode,
  resolveGameMode,
  type GameMode,
} from "../game-mode.js";
import { initTelemetry } from "../telemetry/setup.js";
import type { SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedHostile, CachedRoom } from "../world/world-state.js";

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A modest square at the heart of Townsmee.",
  exits: {},
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};

const GOBLIN: CachedHostile = {
  id: "mon-goblin",
  slug: "goblin",
  name: "goblin",
  description: "A wiry goblin.",
  level: 3,
  baseHp: 12,
  baseDamage: 3,
  experience: 20,
  tags: ["humanoid", "evil"],
};

function buildWorld(mode: GameMode): WorldState {
  const w = new WorldState(mode);
  w.hydrate([SQUARE], [], [GOBLIN]);
  return w;
}

function sessionAt(roomId: string): SessionState {
  return {
    userId: "user-1",
    currentRoomId: roomId,
    currentHp: 30,
    maxHp: 30,
    experience: 0,
    level: 1,
    lives: STARTING_LIVES,
    rebirths: 0,
    inventory: [],
    defeated: false,
    resting: false,
  };
}

/* ── The capability table ─────────────────────────────────────── */

describe("mode capabilities", () => {
  it("gives exploration no hostiles, no combat, no PVP, no looting", () => {
    expect(MODE_CAPABILITIES.exploration).toEqual({
      hostiles: false,
      combat: false,
      playerVersusPlayer: false,
      looting: false,
      scripting: false,
    });
  });

  it("gives pve combat but never player-versus-player or looting", () => {
    expect(MODE_CAPABILITIES.pve.combat).toBe(true);
    expect(MODE_CAPABILITIES.pve.playerVersusPlayer).toBe(false);
    expect(MODE_CAPABILITIES.pve.looting).toBe(false);
  });

  it("gives pvp player combat and looting", () => {
    expect(MODE_CAPABILITIES.pvp.playerVersusPlayer).toBe(true);
    expect(MODE_CAPABILITIES.pvp.looting).toBe(true);
  });

  it("never enables looting without player combat", () => {
    for (const mode of GAME_MODES) {
      const caps = capabilitiesFor(mode);
      if (caps.looting) expect(caps.playerVersusPlayer).toBe(true);
    }
  });

  it("never enables combat without hostiles", () => {
    for (const mode of GAME_MODES) {
      const caps = capabilitiesFor(mode);
      if (caps.combat) expect(caps.hostiles).toBe(true);
    }
  });

  it("never offers scripting without combat", () => {
    // Scripting exists to automate the grind (PRD-0001 R23). Offering it in
    // a world with nothing to fight would be a control that does nothing.
    for (const mode of GAME_MODES) {
      const caps = capabilitiesFor(mode);
      if (caps.scripting) expect(caps.combat).toBe(true);
    }
  });

  it("defines capabilities for every declared mode", () => {
    for (const mode of GAME_MODES) {
      expect(capabilitiesFor(mode)).toBeDefined();
    }
  });
});

/* ── Resolving the mode from the environment ──────────────────── */

describe("resolveGameMode", () => {
  it("defaults to the most restrictive mode when unset", () => {
    // A deployment that forgets to configure a mode must not get hostiles.
    expect(resolveGameMode({})).toBe("exploration");
    expect(DEFAULT_GAME_MODE).toBe("exploration");
  });

  it("treats an empty or whitespace value as unset", () => {
    expect(resolveGameMode({ [GAME_MODE_ENV]: "" })).toBe("exploration");
    expect(resolveGameMode({ [GAME_MODE_ENV]: "   " })).toBe("exploration");
  });

  it.each(GAME_MODES)("accepts %s", (mode) => {
    expect(resolveGameMode({ [GAME_MODE_ENV]: mode })).toBe(mode);
  });

  it("tolerates casing and surrounding whitespace", () => {
    expect(resolveGameMode({ [GAME_MODE_ENV]: "  PVP  " })).toBe("pvp");
  });

  it("throws on an unrecognised value rather than falling back", () => {
    // A silent fallback either strands a PVE host with no hostiles or — far
    // worse in the other direction — hands a mode to a host that did not ask
    // for it. Failing the boot puts the typo in front of the operator.
    expect(() => resolveGameMode({ [GAME_MODE_ENV]: "pvpp" })).toThrow(
      /not a valid game mode/,
    );
    expect(() => resolveGameMode({ [GAME_MODE_ENV]: "creative" })).toThrow(
      /exploration, pve, pvp/,
    );
  });
});

describe("isGameMode", () => {
  it.each(GAME_MODES)("accepts %s", (mode) => {
    expect(isGameMode(mode)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isGameMode("EXPLORATION")).toBe(false);
    expect(isGameMode("")).toBe(false);
    expect(isGameMode(undefined)).toBe(false);
    expect(isGameMode(null)).toBe(false);
    expect(isGameMode(3)).toBe(false);
  });
});

/* ── Guard 1: the spawner ─────────────────────────────────────── */

describe("WorldState — hostiles are gated on the mode", () => {
  it("defaults to exploration when no mode is given", () => {
    expect(new WorldState().mode).toBe("exploration");
    expect(new WorldState().capabilities.hostiles).toBe(false);
  });

  it("refuses to spawn a hostile in exploration", () => {
    const world = buildWorld("exploration");
    expect(() => world.spawnHostile("goblin", SQUARE.id)).toThrow(
      /refused .* "exploration" mode/,
    );
  });

  it("leaves the room empty after a refused spawn", () => {
    const world = buildWorld("exploration");
    expect(() => world.spawnHostile("goblin", SQUARE.id)).toThrow();
    expect(world.getHostilesInRoom(SQUARE.id)).toEqual([]);
  });

  it.each(["pve", "pvp"] as const)("spawns normally in %s", (mode) => {
    const world = buildWorld(mode);
    const instance = world.spawnHostile("goblin", SQUARE.id);
    expect(instance.slug).toBe("goblin");
    expect(world.getHostilesInRoom(SQUARE.id)).toHaveLength(1);
  });

  it("exposes capabilities derived from the mode", () => {
    expect(buildWorld("pvp").capabilities.looting).toBe(true);
    expect(buildWorld("pve").capabilities.looting).toBe(false);
  });
});

/* ── Guard 2: the dispatcher ──────────────────────────────────── */

describe("handlersFor", () => {
  it("omits every combat verb in a world without combat", () => {
    const handlers = handlersFor({ combat: false });
    for (const verb of COMBAT_VERBS) {
      expect(handlers[verb]).toBeUndefined();
    }
  });

  it("includes them when combat is enabled", () => {
    const handlers = handlersFor({ combat: true });
    for (const verb of COMBAT_VERBS) {
      expect(handlers[verb]).toBeDefined();
    }
  });

  it("keeps the non-combat verbs in both", () => {
    for (const combat of [true, false]) {
      const handlers = handlersFor({ combat });
      for (const verb of ["look", "move", "talk", "inventory", "help", "quit"]) {
        expect(handlers[verb]).toBeDefined();
      }
    }
  });
});

describe("dispatch — combat in exploration", () => {
  it("refuses attack with a plain-language message", async () => {
    const world = buildWorld("exploration");
    const result = await dispatch({
      world,
      session: sessionAt(SQUARE.id),
      command: parseCommand("attack goblin"),
    });
    expect(result.response.lines).toEqual([NO_COMBAT_MESSAGE]);
    expect(result.closeSocket).toBe(false);
  });

  it("does not leak the generic unknown-command reply", () => {
    // The refusal has to read as an answer, not as a typo.
    expect(NO_COMBAT_MESSAGE).not.toMatch(/Unknown command/);
  });

  it("refuses every combat verb, not just the one spelled attack", async () => {
    for (const verb of COMBAT_VERBS) {
      const result = await dispatch({
        world: buildWorld("exploration"),
        session: sessionAt(SQUARE.id),
        command: parseCommand(`${verb} goblin`),
      });
      expect(result.response.lines).toEqual([NO_COMBAT_MESSAGE]);
    }
  });

  it.each(["pve", "pvp"] as const)("resolves attack in %s", async (mode) => {
    const world = buildWorld(mode);
    world.spawnHostile("goblin", SQUARE.id);
    const result = await dispatch({
      world,
      session: sessionAt(SQUARE.id),
      command: parseCommand("attack goblin"),
      // Seeded to land the blow. Unseeded, combat can miss and this would
      // fail intermittently — while the subject here is mode gating, not the
      // outcome of a swing.
      rng: createRng(2),
    });
    const text = result.response.lines.join(" ");
    expect(text).toMatch(/strike the goblin/);
    // The assertion that actually belongs to this file: it resolved rather
    // than being refused by the mode.
    expect(text).not.toContain(NO_COMBAT_MESSAGE);
  });
});

describe("dispatch — no combat span is opened in exploration", () => {
  let exporter: InMemorySpanExporter;
  let tracer: Tracer;
  let shutdown: () => Promise<void>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    tracer = handle.tracer;
    shutdown = handle.shutdown;
  });

  afterEach(async () => {
    await shutdown();
    trace.disable();
  });

  it("emits no span at all for a refused combat verb", async () => {
    await dispatch({
      world: buildWorld("exploration"),
      session: sessionAt(SQUARE.id),
      command: parseCommand("attack goblin"),
      tracer,
    });

    // The refusal returns before withSpan, so nothing is recorded. A combat
    // span in an exploration world would mean the code path was entered
    // even if the handler ultimately declined.
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("does emit a dispatch span for a permitted verb", async () => {
    // Guards the test above against passing because telemetry is broken
    // rather than because the refusal short-circuits.
    await dispatch({
      world: buildWorld("exploration"),
      session: sessionAt(SQUARE.id),
      command: parseCommand("look"),
      tracer,
    });

    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain(
      "mud.command.dispatch",
    );
  });
});

/* ── help is mode-aware ───────────────────────────────────────── */

describe("help", () => {
  it("does not advertise attack in exploration", async () => {
    const result = await dispatch({
      world: buildWorld("exploration"),
      session: sessionAt(SQUARE.id),
      command: parseCommand("help"),
    });
    expect(result.response.lines.join("\n")).not.toMatch(/attack/);
  });

  it.each(["pve", "pvp"] as const)("advertises attack in %s", async (mode) => {
    const result = await dispatch({
      world: buildWorld(mode),
      session: sessionAt(SQUARE.id),
      command: parseCommand("help"),
    });
    expect(result.response.lines.join("\n")).toMatch(/attack <monster>/);
  });
});
