# @nehsamud/engine-db

Prisma schema and client for the NehsaMUD Postgres tables.

All tables live in the `mud` Postgres schema (multi-schema). The package owns
the schema definition and its migrations; the engine reads and writes through
the generated client.

## Do not edit a migration that has already been applied

The files under `prisma/migrations/` are **checksum-verified**. Prisma stores a
hash of each one in the target database's `_prisma_migrations` table and
compares on every `migrate deploy` / `migrate status`. Changing an applied
migration — including a comment, including whitespace — makes the next run
report the history as modified against every database that already has it.

This is not hypothetical here: these migrations were carried across a
repository move, and `migrate status` reporting *"Database schema is up to
date!"* afterwards is the evidence they arrived byte-identical. Two
consequences worth stating:

- Some comments in the applied migrations describe an embedding host's
  deployment. They read as stale in this repository and cannot be corrected
  without invalidating the checksum, so they stay.
- Schema changes are new migrations, never edits to old ones.

## The FK to a host user table

`mud.player.user_id` carries a cross-schema foreign key to a `public.user`
table this package does not own. It exists because the schema was first
written inside a host that had one.

That coupling is worth breaking — a standalone deployment should not be
obliged to carry another product's user table — but doing so is a real
migration against live data, not a tidy-up. Tracked as OQ5 in
`docs/prd/PRD-0001-nehsamud.md`.

## Setup

```bash
MUD_DATABASE_URL='postgresql://…' npm run prisma:generate
MUD_DATABASE_URL='postgresql://…' npm run prisma:migrate:deploy
```

`prisma generate` never connects — it validates the URL's shape only — so
`npm run build` works without a database. `prisma.config.ts` supplies an
obviously-unreachable placeholder when `MUD_DATABASE_URL` is unset, which is
why a fresh clone builds and why a *migrate* command against an unset
environment fails naming `unset.invalid` rather than something plausible.

Migrations create an empty schema. The world has no rooms until the engine's
seed runs (`npm run seed` in `@nehsamud/engine`), and without it the engine
exits at boot reporting the spawn room missing.
