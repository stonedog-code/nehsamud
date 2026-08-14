# Container image for the NehsaMUD engine.
#
# Built from the workspace root because the engine and its Prisma package are
# siblings here. That is worth stating plainly: the predecessor of this file
# had to `npm pack` the database package into a tarball and rewrite the
# dependency to a `file:` reference, because the two lived in separate repos
# and the private one is not on npm. Nothing needs vendoring now — `npm ci`
# resolves the sibling directly.
#
# `apps/web` is deliberately excluded from the install. Its manifest is copied
# because `npm ci` validates the lockfile against every workspace it names,
# but `--workspace` filters keep Next and React out of both stages.

# ── Stage 1 — install and compile ────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a source-only change reuses the install layer.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/engine-db/package.json packages/engine-db/
COPY apps/web/package.json apps/web/

RUN npm ci --no-audit --no-fund \
    --include-workspace-root \
    --workspace @nehsamud/engine \
    --workspace @nehsamud/engine-db

COPY packages/engine-db packages/engine-db
COPY packages/engine packages/engine

# engine-db first: it runs `prisma generate`, which produces the client the
# engine type-checks against. No database is contacted — generate validates
# the URL's shape only, and prisma.config.ts supplies a placeholder when
# MUD_DATABASE_URL is unset, which it is here.
RUN npm run build --workspace @nehsamud/engine-db \
    && npm run build --workspace @nehsamud/engine

# ── Stage 2 — runtime ────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/engine-db/package.json packages/engine-db/
COPY apps/web/package.json apps/web/

# Peer dependencies are why this image was 829 MB, and it is not obvious.
#
# `@prisma/client` declares PEER dependencies on `prisma` (the CLI) and on
# `typescript`. npm installs peers automatically, so they arrive as
# dependencies OF A PRODUCTION PACKAGE and `--omit=dev` cannot touch them.
# `npm ci --omit=peer` does not help either: `ci` installs the exact tree the
# lockfile describes and ignores the flag. So they are removed after the fact.
#
# The CLI is the expensive part. It drags in `@prisma/studio-core` — Prisma
# Studio, a *browser UI* — which drags in `react-dom` and `elkjs`. A headless
# WebSocket service was shipping a React application it can never render.
#
# WHY EACH OF THESE IS UNREACHABLE AT RUNTIME:
#
#   prisma               the CLI. `generate` and `migrate` run in CI and in
#                        the build stage, never in the container.
#   typescript           a peer so the GENERATED client can be typed at
#                        compile time. Nothing types anything at runtime.
#   @prisma/studio-core  the Studio browser UI, reachable only from the CLI.
#   @prisma/dev          CLI dev tooling.
#   @prisma/engines      ships `schema-engine`, which performs MIGRATIONS.
#                        This container never migrates; the deploy does that
#                        separately. Queries go through @prisma/adapter-pg
#                        and `pg`, which are real dependencies and stay.
#   react-dom, elkjs     Studio's rendering and graph-layout libraries.
#   @types/*             TypeScript declaration files. Erased at compile time
#                        and never executed, so this one is safe by
#                        definition rather than by argument.
#
# ABOUT 20 MB OF STUDIO DEBRIS IS DELIBERATELY LEFT (`fast-check`,
# `caniuse-lite`, `@visx`, and friends). npm installs flat and does not
# garbage-collect, so they survive their parent's removal — but proving each
# one unreachable costs more than the megabytes are worth on an image that
# is pulled rarely. They are recorded here so the next person knows they
# were seen and skipped, not missed.
#
# PROVEN, NOT ASSUMED, IN TWO PLACES. The `node -e` below fails the BUILD if
# the generated client can no longer be loaded — the cheap half. The
# expensive half is that a missing engine binary fails at the first QUERY
# rather than at boot, so a container from this image is booted against a
# real Postgres and driven through a whole session before this is called
# done. Neither check alone is enough: the import can succeed and the first
# query still die.
RUN npm ci --omit=dev --no-audit --no-fund \
    --include-workspace-root \
    --workspace @nehsamud/engine \
    --workspace @nehsamud/engine-db \
    && npm cache clean --force \
    && rm -rf \
        node_modules/prisma \
        node_modules/typescript \
        node_modules/@prisma/studio-core \
        node_modules/@prisma/dev \
        node_modules/@prisma/engines \
        node_modules/react-dom \
        node_modules/elkjs \
        node_modules/@types

# Compiled output only — no sources, no source maps, no dev dependencies.
# `generated/` carries the Prisma client, so the runtime never runs
# `prisma generate` and needs no Prisma CLI.
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/engine-db/dist packages/engine-db/dist
COPY --from=build /app/packages/engine-db/generated packages/engine-db/generated

# The client must still LOAD with the CLI and its tree gone. Cheap, and it
# turns "we deleted too much" from a production incident into a failed build.
RUN node -e "import('./packages/engine-db/dist/index.js').then(m => { if (typeof m.createMudPrismaClient !== 'function') { throw new Error('engine-db did not export createMudPrismaClient'); } console.log('prisma client loads without the CLI'); })"

# WebSocket, then HTTP (health / metrics / capabilities).
EXPOSE 22009 22010

# The mode is configuration, and an unset MUD_GAME_MODE resolves to
# `exploration` — the safe default. A host serving PVE or PVP must say so.
CMD ["node", "packages/engine/dist/server.js"]
