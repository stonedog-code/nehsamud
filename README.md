# NehsaMUD

A text-based multi-user dungeon in the MajorMud tradition: you create a
character, pick a race and a class, and explore a world by typing where you
want to go.

The product spec is [`docs/prd/PRD-0001-nehsamud.md`](docs/prd/PRD-0001-nehsamud.md).
Read it before changing behaviour — several things that look like gaps are
recorded non-goals.

## The three modes

One engine, three builds, distinguished by what the **server** allows:

| Mode | Monsters | Combat | Player combat | Looting |
|---|---|---|---|---|
| **Exploration** | no | no | no | no |
| **PVE** | yes | yes | no | no |
| **PVP** | yes | yes | yes | yes |

Exploration is the build served to older adults. Its promise is that nothing
in the world can hurt you, so the absence of combat is a property of the
server, never of the interface — a deployment must be *incapable* of combat,
not merely styled without it.

Modes are selected by `NEHSAMUD_MODES`, a comma-separated list read on the
server:

```bash
NEHSAMUD_MODES=exploration npm start   # the senior-safe deployment
NEHSAMUD_MODES=pvp npm start           # a PVP host
npm run dev                            # unset → all three, for development
```

Unset means all three, which is why the dev site can drive every mode from one
server. A production host always names exactly what it serves. An unrecognised
entry is dropped rather than throwing — a typo should narrow what is served,
never widen it.

## Status

This repository currently holds the **PRD and the app**. The engine still
lives in `ElderLink-Solutions/hopper-mud` and moves here in phase 2 of the
rollout plan; until then the play surface runs against a small in-browser
preview world (`src/lib/preview-world.ts`) so the shell and its tests are real
before the engine arrives.

The preview world is not the game. It moves you between six rooms, honours all
ten directions, and refuses combat in Exploration. It has no persistence, no
monsters, and no other players.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

## Tests

Three tiers, all required:

```bash
npm run test:unit    # jest — pure logic: modes, catalog, world
npm run test:e2e     # playwright — the running app, per mode
npm run typecheck
npm run build
```

The e2e tier is where the accessibility and interaction claims are checked;
jsdom has no layout engine and would agree with almost anything.

## Layout

```
docs/prd/          the product spec
src/app/           routes — mode picker, creation, play
src/components/    CharacterCreation, Terminal
src/lib/           modes, catalog, preview world (all unit-tested)
e2e/               Playwright specs
```

## Accessibility

The floor is set by the Exploration audience and applies everywhere: WCAG 2.2
AA minimum, 48px tap targets, visible focus that is never removed, no meaning
carried by colour alone, and a transcript exposed as an `aria-live` log so a
screen-reader player hears the world as it responds.
