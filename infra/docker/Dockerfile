# syntax=docker/dockerfile:1.7
# One multi-stage build for every Node service. Targets: api, worker, web.
ARG NODE_IMAGE=node:22.23.3-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Builds behind a TLS-inspecting proxy can pass its CA without baking it into an image:
#   docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    corepack enable && corepack install -g pnpm@10.28.0
WORKDIR /repo

# Download every dependency once, keyed only on the lockfile.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm fetch --frozen-lockfile

FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@elega/api... --filter=@elega/worker... --filter=@elega/web...
# Pruned manifests + lockfile per service, so each image installs only its production deps.
RUN pnpm turbo prune @elega/api --docker --out-dir /prune/api \
 && pnpm turbo prune @elega/worker --docker --out-dir /prune/worker

FROM base AS api-deps
COPY --from=build /prune/api/json/ ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline --ignore-scripts

FROM base AS worker-deps
COPY --from=build /prune/worker/json/ ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
USER node

FROM runtime AS api
COPY --from=api-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/packages/shared/dist /app/packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/migrations /app/apps/api/migrations
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS worker
COPY --from=worker-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/apps/worker/dist /app/apps/worker/dist
# Email copy is read at runtime from the i18n catalogs (the pruned install has manifests only).
COPY --from=build --chown=node:node /repo/packages/i18n/messages /app/packages/i18n/messages
WORKDIR /app/apps/worker
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3002)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
