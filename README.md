# NehsaMUD

A text-based multi-user dungeon in the MajorMud tradition: you create a
character, pick a race and a class, and explore a world by typing where you
want to go.

The product spec is [`docs/prd/PRD-0001-nehsamud.md`](docs/prd/PRD-0001-nehsamud.md).
Read it before changing behaviour — several things that look like gaps are
recorded non-goals.

## Layout

```
packages/engine      the game engine — world, commands, combat, transport
packages/engine-db   Prisma schema + client for the `mud` Postgres schema
apps/web             the Next.js app: plays every mode, and is the surface
                     the unit / integration / e2e tiers drive
docs/prd             the product spec
```

One npm workspace. The engine is the product; the app is how you play and
test it. HopperGuard consumes `@nehsamud/engine` as a submodule and pins the
mode to Exploration.

## The three modes

One engine, three products, distinguished by what the **server** allows:

| Mode | Monsters | Combat | Player combat | Looting | Scripting |
|---|---|---|---|---|---|
| **Exploration** | no | no | no | no | no |
| **PVE** | yes | yes | no | no | yes |
| **PVP** | yes | yes | yes | yes | yes |

Exploration is the build HopperGuard serves. Its promise is that nothing in
the world can hurt you, so the absence of combat is a property of the server,
never of the interface — a deployment must be *incapable* of combat, not
merely styled without it. Two independent guards enforce that, and both are
required:

- `WorldState.spawnMonster` throws in a world without monsters, so a call
  site that forgets to check fails loudly rather than quietly placing a
  monster in front of someone who was told there were none.
- The dispatcher builds its handler table from the mode, so the combat
  handler is unreachable and no dispatch span is opened for a refused verb.

**The capability table lives in the engine and nowhere else.** The app
re-exports it from `@nehsamud/engine/modes` rather than keeping a copy — a
second copy is a copy that can disagree, and the one that disagrees silently
is the UI.

Two environment variables, deliberately distinct:

| Variable | Read by | Meaning |
|---|---|---|
| `MUD_GAME_MODE` | the engine | the **one** mode this engine process runs. Unset → `exploration`. An unrecognised value fails the boot. |
| `NEHSAMUD_MODES` | the app | which modes this front end offers, comma-separated. Unset → all three (the dev site). |

## Running it

The app alone, against the in-browser preview world — no database needed:

```bash
npm install
npm run dev            # http://localhost:3000
```

The real thing, engine and app together in one mode:

```bash
export MUD_DATABASE_URL='postgresql://…'
npm run dev:all                 # exploration
npm run dev:all -- pve
npm run dev:all -- pvp
```

`dev:all` pins its own ports (`NEHSAMUD_WEB_PORT`, default 3000) rather than
inheriting `PORT`, and takes both processes down if either dies.

### Database

The engine needs Postgres with the `mud` schema:

```bash
MUD_DATABASE_URL='postgresql://…' npm run prisma:migrate:deploy
MUD_DATABASE_URL='postgresql://…' npm run seed
```

Migrations create an empty schema; **the seed is what puts rooms in it**, and
without it the engine exits at boot saying the spawn room is missing.

## Tests

Three tiers, all required — and all three now exist. This section listed two
of them for a while, which is the worse kind of wrong: a documented gate
nobody implemented reads as a gate everyone believes in.

```bash
npm run test:unit         # jest, every workspace — fakes, no I/O
npm run test:integration  # a real Postgres, a real server, a real socket
npm run test:e2e          # playwright against the running app
npm run typecheck
npm run build
```

Each answers something the others structurally cannot:

- **Unit** — does this function do what it says, on every branch. Runs on a
  fresh clone with nothing installed but node_modules.
- **Integration** — do the seams hold. A mocked Prisma client agrees with a
  query the real schema rejects, and stays green through a migration that
  removed the column underneath; this tier asserts on rows. It **refuses to
  run without `MUD_DATABASE_URL`** rather than skipping, because a tier that
  quietly skips itself is the one that stops running and nobody notices. The
  error message tells you exactly how to stand a database up.
- **E2E** — can a person actually do it, in a browser. This is where the
  accessibility and interaction claims are checked; jsdom has no layout
  engine and would agree with almost anything.

## Status

The engine moved here from `ElderLink-Solutions/hopper-mud` and this is now
its only home.

**The app plays the real engine** when one is configured for the build
(`NEXT_PUBLIC_MUD_WS_URL`): rooms, items and characters come from Postgres,
and the e2e tier plays through it. A clone with no engine falls back to a
small in-browser preview world (`apps/web/src/lib/preview-world.ts`) — six
rooms, no persistence, nothing to fight, no other players. **Which one is
running is stated on the page**, because a silent fallback is how "the
engine works" becomes something nobody has actually checked.
It does honour all ten directions, including the four diagonals the engine's
parser cannot yet handle.

## Accessibility

The floor is set by the Exploration audience and applies everywhere: WCAG 2.2
AA minimum, 48px tap targets, visible focus that is never removed, no meaning
carried by colour alone, and a transcript exposed as an `aria-live` log so a
screen-reader player hears the world as it responds.
