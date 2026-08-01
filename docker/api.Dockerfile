# Build context is the repo root (pnpm workspace) — see docker-compose.yml.
#
# The runtime image never sees @nonet/engine or @nonet/shared as packages —
# `pnpm --filter @nonet/api build` (apps/api/build.mjs) bundles their real
# TypeScript source straight into dist/ with esbuild, since those packages
# point `main` at source, not a compiled artifact, which a plain `node`
# can't run (see build.mjs's comment for the full reasoning). Only genuine
# npm dependencies (fastify, drizzle-orm, postgres, ...) need to exist as
# real node_modules in the final image.

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS workspace-manifest
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/bot/package.json apps/bot/package.json

FROM workspace-manifest AS deps
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @nonet/api build

FROM workspace-manifest AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY apps/api/drizzle /repo/apps/api/drizzle
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on every boot, guarded by an advisory lock, so scaling to
# multiple replicas never races (§18).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
