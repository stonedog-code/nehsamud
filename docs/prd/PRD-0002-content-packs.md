# PRD-0002 — Content packs

**Status:** Draft
**Owner:** Jesse Stone
**Created:** 2026-08-13
**Depends on:** PRD-0001 (modes, the engine, the three deployments)

---

## 1. Problem / Why now

One engine is meant to serve worlds that share nothing thematically. The
standalone site is a fantasy MUD — goblins, swords, a town called Townsmee.
HopperGuard is a virtual senior-care centre: nurses, walkers, a day room. The
mechanics are identical. The content is not.

Today the fantasy world is **compiled into the engine**. `packages/engine/src/seed/fixtures/`
holds Townsmee's rooms, its goblins and its Elves and Mages as TypeScript
modules, and `TOWNSMEE_TOWNSQUARE` is hardcoded as the spawn point. A second
world means forking those files, which means two engines diverging.

The good news is that this is smaller than it looks. **The engine already
loads its world from Postgres at boot** — rooms, NPCs, hostiles and items all
come from `mud.*` tables, so two deployments pointed at two databases already
have two different worlds. The expensive half is done. What is missing is a
way to *author* a world without editing the engine.

**Why now:** the schema can still be changed freely. Measured against
production on 2026-08-13: **0 players, 0 inventory rows, 0 room items.** The
only rows are seeded catalog. Every fantasy-shaped column in the schema can be
renamed or restructured today at zero cost, and that stops being true the
first time a resident creates a character.

## 2. Goals

- **G1** — A world is data, authored outside the engine. Adding one requires
  no engine change.
- **G2** — The engine's schema and vocabulary carry no genre. Nothing in it
  should have to be explained away in a care-home deployment.
- **G3** — A pack declares its own character-choice axes, not just their
  values.
- **G4** — Player-facing text a pack cannot supply is the exception, and
  every exception is listed.
- **G5** — Existing behaviour is unchanged for the Townsmee world, which
  becomes the first pack.

### Non-goals

- **NG1** — A world *editor*. Packs are authored as data by developers; a UI
  for building rooms is a different product.
- **NG2** — Runtime pack switching. A world instance serves one pack, chosen
  at boot, exactly as it serves one mode.
- **NG3** — Mixing packs in one world. Nurses and goblins in one building is
  not a feature.
- **NG4** — Translating mechanics. A pack renames and re-themes; it does not
  add rules. A pack cannot invent a stat or a verb.
- **NG5** — Making combat optional *per pack*. That is what modes are for
  (PRD-0001), and duplicating the control would create two places that must
  agree.

## 3. Users & roles

| User | Cares about |
|---|---|
| **Resident** (HopperGuard) | A calm, familiar place. Nurses and a garden, not dungeons. |
| **Fantasy player** (standalone) | The MajorMud-shaped world, unchanged. |
| **World author** | Writing a pack without reading the engine. |
| **Engine maintainer** | Changing mechanics without touching any world. |

## 4. Requirements

### 4.1 The pack

- **R1** A content pack is a data module supplying: rooms and exits, NPCs,
  hostiles, items, character-option groups and options, spawn point, and a
  message catalog.
- **R2** The engine takes exactly one pack at boot, from configuration.
- **R3** The spawn point comes from the pack. `TOWNSMEE_TOWNSQUARE` must not
  appear in engine code.
- **R4** Seeding is `seed(pack)`. The engine ships no world of its own.
- **R5** A pack is validated on load: every exit resolves to a room in the
  same pack, the spawn room exists, and every message key the engine can emit
  is present. A pack that fails validation stops the boot rather than
  producing a world with holes in it.

### 4.2 Genre-neutral schema

The schema can change destructively — see §1. Requirements, not suggestions:

- **R6** `mud.monster` becomes `mud.hostile`. "Monster" is a genre word; the
  mechanic is "a thing that can be fought".
- **R7** `mud.race` and `mud.class` are replaced by
  `mud.character_option_group` + `mud.character_option`. **A pack declares the
  axes**: fantasy has Race and Class, a care centre may have Background and
  Room, and a minimal pack may have none. `mud.player.race_id` / `class_id`
  become rows in `mud.player_option`.
- **R8** Genre-shaped columns go with them — `alignment` and `mob_type` are
  fantasy bestiary fields, and become pack-defined tags rather than columns.
- **R9** `mud.player.user_id`'s cross-schema FK to `public.user` is
  **dropped**. It is a coupling to one host's user table, and a standalone
  deployment has no such table. It becomes `owner_id`, an opaque string the
  host supplies and the engine never interprets. *(This closes PRD-0001 OQ5.)*

### 4.3 Vocabulary

- **R10** Player-facing strings the engine composes come from the pack's
  message catalog, looked up by key with the pack's values interpolated.
- **R11** Every key the engine can emit is enumerated and validated (R5), so a
  missing string is a boot failure rather than `undefined` in a transcript.
- **R12** The product name is a pack value, not a constant. *(Absorbs
  NEH-636.)*
- **R13** Direction names stay engine-owned. `north` is a mechanic, not
  flavour, and a pack renaming it would break every player's muscle memory and
  the scripting language with it.

### 4.4 Migration

- **R14** The `mud` schema is rebuilt to the new shape in a single migration.
  With zero player rows there is nothing to preserve, so this is a rewrite
  rather than a sequence of careful alters.
- **R15** Both live worlds re-seed from their packs afterwards. Catalog data
  is regenerable by definition.

## 5. Design & integration points

### Shape

```
packages/engine            mechanics only — no world, no genre
packages/content-townsmee  the fantasy pack (today's fixtures)
<host-owned>               HopperGuard's care-centre pack
```

A pack is a plain data module. It has no dependency on the engine beyond its
types, so a host can author one without pulling express or Prisma in.

### What a pack does NOT get to change

Worth stating, because the boundary is the whole design:

- the direction set and movement rules
- the command grammar and verb list
- combat resolution, the XP curve, levelling
- modes and their capabilities (PRD-0001)
- the wire protocol

A pack supplies **nouns and prose**. The engine owns **verbs and rules**.

### The care-centre case is easier than it looks

HopperGuard runs Exploration: no hostiles, no combat, no looting. So the
mapping people reach for — "goblins become nurses" — is not needed. Nurses are
NPCs, walkers are items, the day room is a room, and the hostile table is
simply empty. The mechanics that would need re-theming are the ones the mode
already switches off, which is a real payoff from PRD-0001.

## 6. Accessibility & plain language

Pack-supplied prose is player-facing text, so the PRD-0001 §6 floor applies to
it and not only to the UI: plain language, no jargon, and nothing that depends
on colour or an icon to be understood. **A pack can regress accessibility in a
way the engine cannot catch** — a room description written as a wall of
subordinate clauses is valid data. Pack review covers reading level, and the
care-centre pack is held to the stricter bar its audience needs.

## 7. Rollout

| Phase | Delivers |
|---|---|
| **1** | `ContentPack` type + validation (R1, R5). Townsmee moves into a pack unchanged. |
| **2** | Spawn point and seeding take the pack (R2–R4). |
| **3** | Schema rebuild: hostile, option groups, owner_id, tags (R6–R9, R14–R15). |
| **4** | Message catalog and product name (R10–R12). |
| **5** | The care-centre pack, authored against the finished contract. |

Phase 3 is the one with a deadline attached: it is free only while the player
tables are empty.

## 8. Success criteria

1. A new world ships with no engine change.
2. No genre word appears in engine source or schema — checked by a test, not
   by review.
3. Townsmee plays identically to before.
4. HopperGuard serves a care centre with no hostiles and no combat vocabulary
   anywhere in what a resident can see.
5. A pack missing a message key or naming a nonexistent spawn room fails the
   boot.

## 9. Open questions

- **OQ1 — Where does a host's pack live?** In the host's repo (HopperGuard
  owns its care-centre content) or as packages here? Host-owned is the
  stronger answer for HIPAA — resident-facing copy stays inside their
  boundary — but it means the pack contract is a published API.
- **OQ2 — Are character options required?** A care centre may want no
  character creation at all: you are a resident, you walk in. That may be a
  pack with zero option groups, or a mode-level decision.
- **OQ3 — How far does the message catalog go?** Every string, or only those
  naming pack nouns? Every string is more work and makes localisation
  possible later.
- **OQ4 — Does the scripting language (PRD-0001 R20–R24) reference pack
  nouns?** `attack goblin` is content; `while hp < 50` is mechanics. Scripts
  written against one pack will not run against another, and that is probably
  correct — but it should be a decision.
