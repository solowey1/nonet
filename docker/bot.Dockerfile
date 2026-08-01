# Build context is the repo root (pnpm workspace) — see docker-compose.yml.
# Same bundling rationale as docker/api.Dockerfile (see apps/bot/build.mjs).

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
COPY apps/bot apps/bot
RUN pnpm --filter @nonet/bot build

FROM workspace-manifest AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/apps/bot/dist /repo/apps/bot/dist
WORKDIR /repo/apps/bot
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
