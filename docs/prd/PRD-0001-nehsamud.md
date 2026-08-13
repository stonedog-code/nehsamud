# PRD-0001 — NehsaMUD

**Status:** Draft
**Owner:** Jesse Stone
**Created:** 2026-08-12
**Applies to:** `stonedog-code/nehsamud` (engine + standalone app), and the
Exploration build embedded in HopperGuard.

---

## 1. Problem / Why now

A MajorMud-style text MUD exists in three partly-overlapping forms today: the
original Python server, a Node/TypeScript rewrite embedded in a larger product,
and a web client tied to that product's auth. The rewrite is a working
skeleton — it boots, serves a town, and is deployed — but the progression loop
that makes a MUD a game is absent, and there is no single place the engine
lives.

Two things force the issue now:

1. **One engine, three audiences.** The same world has to serve a
   combat-free build for older adults and a full PVP build for everyone else.
   Without a first-class notion of a game mode, that difference is a deployment
   convention — and a convention cannot be tested.
2. **No home for the engine.** Consumers cannot share what is embedded in one
   consumer's monorepo.

## 2. Goals

- **G1** — One engine, one repository, consumed by every surface.
- **G2** — Three modes: Exploration, PVE, PVP. Mode is server-side and
  enforced, not presentational.
- **G3** — A complete progression loop: create a character, explore, gain
  experience that persists, reach level 100.
- **G4** — A player-facing scripting language for automating experience
  gathering.
- **G5** — A standalone Next.js app that plays all three modes and serves as
  the unit / integration / e2e testing surface.

### Non-goals

- **NG1** — Graphics. The world is text; room art is an optional enhancement,
  never a requirement.
- **NG2** — Real-money trading, or any economy that crosses the
  player/currency boundary.
- **NG3** — Cross-mode character transfer. A character belongs to one world
  instance. Carrying a PVP-looted inventory into Exploration is not a feature.
- **NG4** — Horizontal scaling in v1. Sessions are in-process; a single
  world process per deployment is the supported topology.
- **NG5** — Preserving the Python implementation. It is reference material.

## 3. Users & roles

| User | Mode | Needs |
|---|---|---|
| **Resident / senior player** | Exploration | A calm world to wander. No threat, no loss, no time pressure. Large text, plain language. |
| **Casual player** | PVE | Character growth against monsters, at their own pace. |
| **Competitive player** | PVP | Risk. Other players are the content, and losing means losing things. |
| **Scripter** | PVE / PVP | Automating the grind, and having that be a legitimate skill. |
| **Developer** | all | One local surface exercising every mode. |

## 4. Requirements

Numbered and testable. **MUST** is v1 scope; **SHOULD** is v1 if it fits.

### 4.1 Modes

- **R1** The world instance carries a mode of `exploration`, `pve`, or `pvp`,
  read from server configuration at boot.
- **R2** A client MUST NOT be able to change the mode. No frame, header, query
  parameter, or cookie may influence it.
- **R3** In `exploration`, no monster spawns. Enforcement is in the spawner,
  not only the UI.
- **R4** In `exploration`, combat verbs are not registered in the dispatcher.
  A player typing `attack` receives an ordinary unknown-command response — the
  code path must be absent, not hidden.
- **R5** In `pve`, monsters spawn and combat resolves. Players cannot target
  each other.
- **R6** In `pvp`, players may additionally target each other.
- **R7** Each mode is a separate deployment on its own host.

> **R3 and R4 are both required, deliberately.** Either alone leaves a
> reachable path to combat in the build whose entire premise is that there
> isn't one.

### 4.2 Characters

- **R8** A player picks a race and a class at creation. Six of each at
  launch — Human, Elf, Dwarf, Halfling, Orc, Half-Orc; Warrior, Mage, Rogue,
  Cleric, Ranger, Bard.
- **R9** Race and class MUST measurably change play: starting HP, damage, and
  per-level gains derive from them.
- **R10** Character names are unique per world instance.
- **R11** A character persists across sessions: name, race, class, level,
  experience, current room, inventory.

### 4.3 World & navigation

- **R12** Navigation accepts ten directions: `n s e w ne nw se sw u d`, with
  long forms.
- **R13** Every exit is traversable in both directions unless explicitly
  one-way, and one-way exits are marked in the fixture.
- **R14** The starting area is a town. At least two further areas exist beyond
  it, with difficulty rising outward.
- **R15** `look` describes the room, its exits, its occupants, and its items.

### 4.4 Progression

- **R16** Experience persists to the database. A disconnect MUST NOT lose it.
- **R17** Levels run 1 to 100 on a documented curve.
- **R18** Level-up applies stat gains and announces itself.
- **R19** The world holds enough content to reach 100 without grinding one
  room.

### 4.5 Scripting

- **R20** Players can write scripts that issue game commands.
- **R21** Scripts run under a hard instruction budget and a wall-clock cap.
- **R22** A script MUST NOT be able to degrade the world for other players.
- **R23** Scripting is unavailable in Exploration.
- **R24** Scripts cannot do anything a player could not type by hand.

### 4.6 PVP & looting

- **R25** In `pvp`, `attack <player>` resolves against players in the room.
- **R26** On death the victim's inventory becomes lootable by the winner.
- **R27** Looting is the winner's **choice**. Declining is a supported path.
- **R28** The transfer is atomic — one transaction. A crash mid-loot MUST NOT
  duplicate or destroy items.
- **R29** The victim keeps their character, level, and experience. Only items
  are at stake.

### 4.7 Testing

- **R30** Unit, integration, and e2e tiers. Integration runs against a real
  Postgres with the real schema.
- **R31** E2E covers all three modes, including a test asserting Exploration
  cannot enter combat.
- **R32** Every tier gates the merge in CI.

## 5. Design & integration points

### Repository layout (target)

```
stonedog-code/nehsamud
├── packages/engine      the MUD engine — world, commands, combat, scripting
├── apps/web             the standalone Next.js app (this scaffold)
└── docs/prd             this document
```

Consumed by:

- **HopperGuard** — as a submodule at `packages/hopper-mud`, which becomes a
  thin adapter (auth, config, mode pinned to `exploration`).
- **Standalone sites** — one deployment per mode.

### Persistence

Tables live in the `mud` Postgres schema, owned by the `hopper-mud-db` Prisma
schema today. `mud.player.user_id` carries a cross-schema FK to `public.user`,
which is a HopperGuard-specific coupling — **the extraction must break it.**
The engine should define the repository interfaces it needs and let each host
supply the implementation, so the standalone app is not obliged to carry
HopperGuard's user table.

### Transport

WebSocket. First frame from a new socket must be `AUTH`; anything else closes
the socket with 4401. HTTP sidecar exposes `/health`, `/metrics`,
`/capabilities`.

### Auth

HopperGuard mints an HS256 JWT at `/api/mud/auth-token`, audience-pinned to
the MUD. The standalone app has no such session and needs its own account
model — **open question OQ2**.

## 6. Accessibility & plain language

The Exploration build serves older adults, so it sets the floor for all three.

- Text is the interface: it must be resizable to 200% without loss, and the
  transcript must be reachable by screen reader as a live region.
- Contrast at WCAG 2.2 AA minimum; the house target is AAA. Never colour alone
  to carry meaning — a red monster name must also read as one.
- Tap targets ≥ 48×48 for the direction pad and command controls.
- Command vocabulary is plain: `look`, `go north`, `talk to`. Abbreviations are
  a convenience for experienced players, never the only way.
- No time pressure in Exploration. Nothing expires, nothing chases.
- Every icon carries a visible label.

## 7. Rollout / phasing

Each phase is a reviewable slice; later phases assume earlier ones.

| Phase | Delivers |
|---|---|
| **0** | This PRD, the app scaffold, the mode model. *(this change)* |
| **1** | Game modes in the engine — R1–R7. Blocks the extraction. |
| **2** | Engine extraction into nehsamud; both consumers build from it. |
| **3** | Progression — XP persistence, the 1–100 curve, race/class stats. R9, R16–R19. |
| **4** | World — diagonals, areas beyond the town. R12–R14. |
| **5** | Verb parity — `get`/`drop`/`say`/`equip`/`rest`/… |
| **6** | Combat depth — weapons, rolls, armour. |
| **7** | PVP + looting. R25–R29. |
| **8** | Scripting. R20–R24. |
| **9** | Full test tiers in CI. R30–R32. |

Phase 1 precedes phase 2 deliberately: extracting first means doing the mode
work twice, across a repository boundary.

## 8. Success criteria

1. A character is created, explores multiple areas, gains experience that
   survives a reconnect, and can reach level 100.
2. All ten directions navigate.
3. An Exploration deployment cannot enter combat under any input, proven by
   test.
4. A player automates experience gathering with a script, within its caps.
5. A PVP winner loots a victim atomically, and can decline.
6. All three tiers pass in CI on every merge.

## 9. Open questions

- **OQ1 — Scripting location.** Client-side macros or server-side execution?
  Server-side allows offline play and is the MajorMud-authentic answer; it is
  also a denial-of-service surface pointed at every other player in the world.
  *Leaning: client-side for v1, server-side behind a hard sandbox later.*
- **OQ2 — Standalone auth.** Its own accounts, `stonedog-auth`, or a dev-only
  minter? Blocks the standalone app leaving dev.
- **OQ3 — Death cost in PVP.** R29 puts only items at stake. Is that enough
  risk for the mode to mean anything?
- **OQ4 — Experience curve shape.** Exponential to 100 is traditional and
  brutal. What total playtime is level 100 meant to represent?
- **OQ5 — Engine/DB boundary.** How much of the Prisma schema moves into
  nehsamud versus staying host-supplied? Decided during phase 2.
- **OQ6 — Public or private.** The engine is destined for npm. Publishing
  requires auditing for private artwork and internal references first.
