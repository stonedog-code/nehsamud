# PRD-0001 — NehsaMUD

**Status:** Phases 0–2 shipped; 3–9 not started

> A status line is a claim, not evidence. What "shipped" means here is
> narrow and worth stating: the engine runs, enforces its modes, and reports
> them to clients. **None of the progression the game is actually about
> exists yet** — experience does not persist, no character can gain a level,
> and the world is one town. Read §7 for what is and is not built before
> relying on any requirement below being live.
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
- **R4** In `exploration`, combat verbs are not registered in the dispatcher —
  the handler must be unreachable, not hidden, and no combat span may be
  opened. A player typing `attack` receives a plain-language refusal
  ("There is no fighting in this world. Nothing here will harm you."), not the
  generic unknown-command reply: the expectation is reasonable and deserves an
  answer, and this audience is the one least served by a response that reads
  like they made a mistake.
- **R5** In `pve`, monsters spawn and combat resolves. Players cannot target
  each other.
- **R6** In `pvp`, players may additionally target each other.
- **R7** Each mode is a separate deployment on its own host.
- **R7a** The server **tells the client** what the world permits, in the
  `AUTH_OK` frame. A client MUST NOT determine capabilities from a package it
  was compiled against.
- **R7b** A client that cannot read the capabilities — an older server, a
  malformed or partial payload, or the moment before `AUTH_OK` arrives — MUST
  assume **nothing is permitted**. A partial payload is rejected wholesale
  rather than field by field.

> **Why R7a, since a shared constant would be simpler.** It was tried, and
> reverted. Two reasons it is worse, one practical and one that matters more:
>
> A shared constant is only correct when both sides were built from the same
> version. The frame is answered by the process actually serving *this*
> connection, so a client pointed at a different world learns the truth from
> it. The values cannot drift because they are never copied — which is a
> stronger guarantee than the constant was bought for.
>
> And it kept the engine out of browser bundles. Sharing the table at compile
> time meant a package carrying express, Prisma and an OpenTelemetry SDK sat
> at the edge of the client build, and needed hand-written module mapping in
> three separate test configs, across a submodule boundary in a second GitHub
> organisation, to share five booleans.
>
> Declaring the *shape* of the frame in a client is not the duplication this
> forbids. Every client declares what it receives; it is the **data** that
> must have one source, and the data arrives at runtime.

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

#### Lives and rebirth — SETTLED

- **R19a** The level cap is **100**. Confirmed rather than lowered.
- **R19b** A character has **nine lives**. A death — to a hostile or to
  another player — spends one and costs nothing else.
- **R19c** On the ninth death the character is **reborn**: it keeps its name
  and **30% of its accumulated experience**, its level is re-derived from
  that figure, its lives reset to nine, and its rebirth count increments.
- **R19d** A reborn character **chooses its creation options again**.
  Rebirth is therefore the only way to change build, which is deliberate:
  the options are otherwise permanent.

**Not permadeath, and that is the decision.** Deleting the character is a
different product, and this engine also serves an audience for whom losing
everything to one bad fight is the moment they stop playing. Cutting
experience keeps the loss real — a level 60 character returns around level
40 — while leaving something to come back to.

**It also answers "is 100 reachable".** At the measured rate (~1,335
experience per full clear of 22 spawn points, refilling every 90s) the cap
is ~182 hours of pure combat at the theoretical maximum. Nine lives makes
that a survivable journey rather than a coin flip, and rebirth means a
player who exhausts them is set back rather than ended.

### 4.5 Scripting

- **R20** Players can write scripts that issue game commands.
- **R21** Scripts run under a hard instruction budget and a wall-clock cap.
- **R22** A script MUST NOT be able to degrade the world for other players.
- **R23** Scripting is unavailable in Exploration.
- **R24** Scripts cannot do anything a player could not type by hand.

#### The language

Settled, and deliberately tiny (`packages/engine/src/scripting/`). Five
forms and nothing else:

```
attack goblin              a command, passed through exactly as typed
repeat 5: attack goblin    a fixed number of times
while hp < 50: rest        while a condition about YOU holds
if hp > 80: attack goblin  once, if it holds
stop                       give up early
```

Conditions read `hp`, `maxhp`, `level` and `xp` — the player's own state,
read-only — and compare against a number. There are no variables, no
assignment, no arithmetic, no function calls, and no way to name anything.

**That is the whole of R24 and most of R22.** A language whose only verbs
are the game's own verbs cannot express something a player could not type,
so there is no sandbox to escape from. Embedding a general-purpose
interpreter and fencing it off is the harder problem, and the fence is the
part that gets it wrong.

**R21 lives in the runner, not in the host.** Three caps, because one is not
enough: a command budget (the real defence — wall-clock alone will not stop
a tight loop on a fast machine), a step budget (a loop can spin without
issuing anything, and would never reach a command limit), and a wall-clock
cap. A host that forgets to pass limits still gets the defaults.

**The runner is a step machine.** It hands the host ONE command and waits to
be given the resulting state, because `while hp < 50: rest` has to see the
hp that resting produced. The obvious alternative — walk the program, return
a list of commands — evaluates the condition once and so either emits
nothing or loops forever.

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

Tables live in the `mud` Postgres schema, owned by `@nehsamud/engine-db`.
`mud.player.user_id` carries a cross-schema FK to a host-supplied user table,
which is a coupling to whichever host created it — **worth breaking.** The
engine should define the repository interfaces it needs and let each host
supply the implementation, so a standalone deployment is not obliged to carry
another product's user table.

The FK is still in place, and **PRD-0002 removes it**. That was originally
deferred because these migrations are checksum-verified against a live
database, making any change deliberate rather than a tidy-up. It is affordable
now for a measured reason: production holds **zero** players, inventory rows
and room items, so the schema can be rebuilt outright. That window closes the
first time a resident creates a character.

### Transport

WebSocket. First frame from a new socket must be `AUTH`; anything else closes
the socket with 4401. HTTP sidecar exposes `/health`, `/metrics`,
`/capabilities`.

`AUTH_OK` carries the world's mode and capabilities, so a client never has to
infer them (R7a):

```json
{ "type": "AUTH_OK", "userId": "…",
  "mode": "exploration",
  "capabilities": { "monsters": false, "combat": false,
                    "playerVersusPlayer": false, "looting": false,
                    "scripting": false } }
```

The fields are additive — a client that ignores them still works. A server
with no world loaded reports the **safe** mode rather than omitting them,
because a client reading a missing capability as "combat allowed" fails in
the dangerous direction.

### Auth

The engine verifies an HS256 JWT, audience-pinned to the MUD, and the
embedding host is responsible for minting it from whatever session it already
has. The standalone app has no such session and needs its own account model —
**open question OQ2**.

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
| **0** | ✅ This PRD, the app scaffold, the mode model. |
| **1** | ✅ Game modes in the engine — R1–R7, plus R7a/R7b over the wire. |
| **2** | ✅ Engine extraction into nehsamud. |
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

  **ANSWERED: client-side.** Scripts run in whatever client the player
  brings — including third-party apps written in C# or Python — driving the
  same WebSocket frames a person's client sends. The contract is therefore
  the **wire protocol**, documented in `docs/PROTOCOL.md`, not a package.

  That decision moves R21/R22 somewhere specific. The `ScriptRunner` budget
  governs only scripts the engine itself runs, and a client in another
  language inherits none of it — so the defence that matters is a
  **server-side command rate limit** no client can opt out of: 5/second
  sustained, 20 burst, per connection. See `packages/engine/src/rate-limit.ts`.

  Server-side *execution* — scripts running while a player is offline —
  remains unbuilt and is a separate question. Original note follows.

  The language and its runner
  (§4.5) are host-agnostic by construction: the runner hands out one command
  and waits for the resulting state, so a browser driving that loop over the
  WebSocket and the engine driving it in-process are the same loop. Whichever
  answer this gets, the language does not change; only where it is
  instantiated does. What is still undecided is offline execution, which only
  server-side can offer, and who bears the cost of a runaway script.
- **OQ2 — Standalone auth.** Its own accounts, `stonedog-auth`, or a dev-only
  minter? Blocks the standalone app leaving dev.
- ~~**OQ3 — Death cost in PVP.**~~ **Answered by R19b–d.** Items are at
  stake *and* a life. A PVP death is an ordinary death: it spends one of
  nine, and the ninth reborns the victim at 30% experience with a new build.
  So the mode's stakes are the same as the world's, which is the answer that
  needs no second rule to keep in step. Original text: R29 puts only items at stake. Is that enough
  risk for the mode to mean anything?
- ~~**OQ4 — Experience curve shape.**~~ **Answered: the cap stays 100** and
  the curve is unchanged. ~182 hours of pure combat at the theoretical
  maximum rate is the intended shape — traditional, and survivable because
  of nine lives rather than in spite of the curve.
- ~~**OQ5 — Engine/DB boundary.**~~ **Answered by PRD-0002.** The schema stays
  in this repo; the host-specific part of it — `mud.player.user_id`'s
  cross-schema FK to a `public.user` table this repo does not own — is
  **dropped** and becomes an opaque `owner_id` the host supplies. The
  abstraction originally imagined here (repository interfaces, host injects
  Prisma) is not needed to achieve that, and would have been speculative.
- ~~**OQ6 — Public or private.**~~ **Answered: public, Apache-2.0**, holder
  StoneDogCode L.L.C. The pre-publication audit found no secrets, credentials,
  issue ids or private artwork; the only finding was the licence itself, which
  had arrived as un-adopted GPL-3 and conflicted with the proprietary
  embedding this engine is built for.
