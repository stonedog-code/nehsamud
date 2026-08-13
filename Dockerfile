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

RUN npm ci --omit=dev --no-audit --no-fund \
    --include-workspace-root \
    --workspace @nehsamud/engine \
    --workspace @nehsamud/engine-db \
    && npm cache clean --force

# Compiled output only — no sources, no source maps, no dev dependencies.
# `generated/` carries the Prisma client, so the runtime never runs
# `prisma generate` and needs no Prisma CLI.
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/engine-db/dist packages/engine-db/dist
COPY --from=build /app/packages/engine-db/generated packages/engine-db/generated

# WebSocket, then HTTP (health / metrics / capabilities).
EXPOSE 22009 22010

# The mode is configuration, and an unset MUD_GAME_MODE resolves to
# `exploration` — the safe default. A host serving PVE or PVP must say so.
CMD ["node", "packages/engine/dist/server.js"]
