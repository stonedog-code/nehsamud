import { dispatch } from "../commands/dispatch.js";
import { restAmount } from "../commands/handlers/status.js";
import { parseCommand } from "../commands/parser.js";
import { MAX_LEVEL, xpForLevel } from "../progression.js";
import { DEFAULT_MAX_HP } from "../world/session.js";
import type { CharacterSheet, SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedMonster, CachedRoom } from "../world/world-state.js";

/**
 * `statistics`, `experience` and `rest` — the verbs that let a player see
 * what they are and get back on their feet.
 *
 * `rest` carries the most rules of the three, and they are all refusals: it
 * is the only verb that restores HP, so every way it can be abused (mid
 * fight, while dead) is a way the combat tier stops mattering.
 */

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A modest square.",
  exits: { north: "room-inn" },
  environment: "townsmee",
  imageName: null,
};
const INN: CachedRoom = {
  id: "room-inn",
  enumKey: "TOWNSMEE_INN",
  name: "The Quiet Bed",
  description: "Warm.",
  exits: { south: "room-square" },
  environment: "townsmee",
  imageName: null,
};

const SHEET: CharacterSheet = {
  raceName: "Human",
  className: "Warrior",
  strength: 14,
  intelligence: 9,
  wisdom: 10,
  charisma: 11,
  constitution: 13,
  dexterity: 12,
  luck: 8,
};

const GOBLIN: CachedMonster = {
  id: "mon-goblin",
  slug: "goblin",
  name: "a goblin",
  description: "Wiry and unpleasant.",
  level: 1,
  baseHp: 8,
  baseDamage: 2,
  experience: 15,
  alignment: "evil",
  mobType: "humanoid",
};

function buildWorld(mode: "exploration" | "pve" = "pve"): WorldState {
  const w = new WorldState(mode);
  // Exploration worlds refuse to spawn monsters at all, so the catalog is
  // hydrated either way and only the pve worlds ever populate a room.
  w.hydrate([SQUARE, INN], [], [GOBLIN], [], []);
  return w;
}

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    userId: "u-1",
    characterName: "Aria",
    currentRoomId: SQUARE.id,
    currentHp: DEFAULT_MAX_HP,
    maxHp: DEFAULT_MAX_HP,
    experience: 0,
    level: 1,
    inventory: [],
    defeated: false,
    resting: false,
    sheet: SHEET,
    ...over,
  };
}

const run = async (w: WorldState, s: SessionState, input: string) =>
  (await dispatch({ world: w, session: s, command: parseCommand(input) }))
    .response.lines.join("\n");

/* ── statistics ───────────────────────────────────────────────── */

describe("statistics", () => {
  it("shows name, level, race, class, health and every attribute", async () => {
    const text = await run(buildWorld(), session(), "statistics");
    expect(text).toContain("Aria — level 1");
    expect(text).toContain("Human Warrior");
    expect(text).toContain(`Health: ${DEFAULT_MAX_HP} of ${DEFAULT_MAX_HP}`);
    for (const stat of [
      "Strength 14",
      "Intelligence 9",
      "Wisdom 10",
      "Charisma 11",
      "Constitution 13",
      "Dexterity 12",
      "Luck 8",
    ]) {
      expect(text).toContain(stat);
    }
  });

  it("names only attributes the schema actually has", async () => {
    // The Python original listed determination, faith and perception — none
    // of which are columns. A sheet that shows a stat nothing can change is
    // worse than one that omits it.
    const text = await run(buildWorld(), session(), "statistics");
    for (const ghost of ["Determination", "Faith", "Perception", "Mood"]) {
      expect(text).not.toContain(ghost);
    }
  });

  it("derives the level from experience, not the session's level field", async () => {
    // The level field is a cache. If it disagrees, the XP wins.
    const s = session({ experience: xpForLevel(5), level: 99 });
    const text = await run(buildWorld(), s, "stats");
    expect(text).toContain("level 5");
    expect(text).not.toContain("level 99");
  });

  it("reports conditions, and says healthy when there are none", async () => {
    expect(await run(buildWorld(), session(), "statistics")).toContain(
      "Condition: healthy",
    );
    expect(
      await run(buildWorld(), session({ resting: true }), "statistics"),
    ).toContain("resting");
    expect(
      await run(buildWorld(), session({ defeated: true }), "statistics"),
    ).toContain("defeated");
  });

  it("still renders for a session with no sheet loaded", async () => {
    // In-memory sessions and the window before `create <name>` have no row
    // behind them. Throwing there would make `statistics` the one verb that
    // can crash a fresh connection.
    const text = await run(buildWorld(), session({ sheet: undefined }), "stats");
    expect(text).toContain("Race and class unknown");
    expect(text).toContain("Aria — level 1");
  });

  it("says there is nothing left to earn at the level cap", async () => {
    const s = session({ experience: xpForLevel(MAX_LEVEL) });
    expect(await run(buildWorld(), s, "statistics")).toContain(
      "You have reached the highest level",
    );
  });
});

/* ── experience ───────────────────────────────────────────────── */

describe("experience", () => {
  it("gives the total a scale, which the original never did", async () => {
    // "You have 240 experience." answers nothing on its own.
    const s = session({ experience: 240 });
    const text = await run(buildWorld(), s, "exp");
    expect(text).toContain("240 experience");
    expect(text).toMatch(/\d+ more to level \d+/);
    expect(text).toMatch(/of the way there/);
  });

  it("counts progress within the current level, not from zero", async () => {
    // Sitting exactly on a level boundary means 0 of the span earned, not
    // all of the XP so far.
    const s = session({ experience: xpForLevel(4) });
    const span = xpForLevel(5) - xpForLevel(4);
    expect(await run(buildWorld(), s, "experience")).toContain(
      `(0 of ${span} of the way there)`,
    );
  });

  it("stops promising a next level at the cap", async () => {
    const s = session({ experience: xpForLevel(MAX_LEVEL) });
    const text = await run(buildWorld(), s, "exp");
    expect(text).toContain("nothing further to earn");
    expect(text).not.toMatch(/more to level/);
  });
});

/* ── rest ─────────────────────────────────────────────────────── */

describe("rest", () => {
  it("heals a fraction of maximum, not a flat amount", async () => {
    // Flat healing makes recovery scale wrongly: trivial at level 1,
    // interminable at 100.
    expect(restAmount(30)).toBe(6);
    expect(restAmount(200)).toBe(40);
  });

  it("never heals zero, however small the pool", async () => {
    expect(restAmount(1)).toBe(1);
    expect(restAmount(4)).toBe(1);
  });

  it("restores health and reports the new total", async () => {
    const s = session({ currentHp: 10, maxHp: 30 });
    const text = await run(buildWorld(), s, "rest");
    expect(s.currentHp).toBe(16);
    expect(text).toContain("recover 6 health");
    expect(text).toContain("Health: 16 of 30");
  });

  it("never overheals past maximum", async () => {
    const s = session({ currentHp: 28, maxHp: 30 });
    const text = await run(buildWorld(), s, "rest");
    expect(s.currentHp).toBe(30);
    expect(text).toContain("recover 2 health");
    expect(text).toContain("fully rested");
  });

  it("is repeatable, which is what makes it scriptable", async () => {
    // `while hp < 50: rest` is the scripting use case (NEH-623). It only
    // works if each invocation makes progress.
    const w = buildWorld();
    const s = session({ currentHp: 1, maxHp: 30 });
    for (let i = 0; i < 10; i += 1) await run(w, s, "rest");
    expect(s.currentHp).toBe(30);
  });

  it("refuses while a monster is in the room, and clears the flag", async () => {
    const w = buildWorld();
    w.spawnMonster("goblin", SQUARE.id);
    const s = session({ currentHp: 5, maxHp: 30, resting: true });
    const text = await run(w, s, "rest");
    expect(text).toContain("cannot rest");
    expect(s.currentHp).toBe(5);
    expect(s.resting).toBe(false);
  });

  it("refuses while defeated", async () => {
    const s = session({ currentHp: 0, defeated: true });
    const text = await run(buildWorld(), s, "rest");
    expect(text).toContain("in no condition to rest");
    expect(s.currentHp).toBe(0);
  });

  it("accepts a rest at full health without claiming to have healed", async () => {
    const s = session();
    const text = await run(buildWorld(), s, "rest");
    expect(text).toContain("already at full health");
    expect(text).not.toContain("recover");
    expect(s.resting).toBe(true);
  });
});

/* ── the flag has to be cleared by everything that breaks it ──── */

describe("resting ends when it should", () => {
  it("ends on movement", async () => {
    const w = buildWorld();
    const s = session({ resting: true });
    await run(w, s, "north");
    expect(s.currentRoomId).toBe(INN.id);
    expect(s.resting).toBe(false);
  });

  it("ends on attacking, even when the swing finds nothing", async () => {
    const w = buildWorld();
    const s = session({ resting: true });
    await run(w, s, "attack nothing-here");
    expect(s.resting).toBe(false);
  });

  it("is not left set by a refused rest", async () => {
    const w = buildWorld();
    w.spawnMonster("goblin", SQUARE.id);
    const s = session({ resting: true });
    await run(w, s, "rest");
    expect(s.resting).toBe(false);
  });
});

/* ── discoverability ──────────────────────────────────────────── */

describe("help and aliases", () => {
  it("lists all three verbs", async () => {
    const text = await run(buildWorld(), session(), "help");
    expect(text).toContain("statistics (stats)");
    expect(text).toContain("experience (exp)");
    expect(text).toContain("rest");
  });

  it("accepts the short forms", async () => {
    const w = buildWorld();
    expect(await run(w, session(), "stats")).toContain("Aria — level 1");
    expect(await run(w, session(), "stat")).toContain("Aria — level 1");
    expect(await run(w, session(), "xp")).toContain("experience");
    expect(await run(w, session(), "exp")).toContain("experience");
  });

  it("offers rest in Exploration, where there is nothing to fight", async () => {
    // rest is not a combat verb: an exploration world still has fall damage
    // ambitions and, more to the point, refusing it there would make the
    // senior build's help list differ for no reason a player could see.
    const text = await run(buildWorld("exploration"), session(), "help");
    expect(text).toContain("rest");
  });
});
