# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the LightChain chat frontend (Next.js 15).
# NEXT_PUBLIC_* values are baked at build time, so the orchestrator compose
# passes them via `build.args`. Runtime-only secrets (POSTGRES_URL, AUTH_SECRET,
# REDIS_URL, AI_PROVIDER_BASE_URL, MODEL_NAME) arrive via `environment`.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Native-addon dependencies (bufferutil, utf-8-validate, keccak, sharp) need
# python3 + make + g++ for node-gyp builds. Matches consumer-api/Dockerfile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# ---- deps stage: full install for the Next.js build ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder stage: build the Next.js app with public env baked in ----
FROM deps AS builder
WORKDIR /app

# Build-time args — NEXT_PUBLIC_* values are inlined into client bundles.
ARG NEXT_PUBLIC_USE_PROTOCOL=true
ARG NEXT_PUBLIC_LCAI_IS_TESTNET
ARG NEXT_PUBLIC_CONSUMER_API_URL
ARG NEXT_PUBLIC_PROJECT_ID
ARG NEXT_PUBLIC_JOB_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_AI_CONFIG_ADDRESS
ARG NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_RELAY_URL
ARG NEXT_PUBLIC_RPC_URL
# Sortition (dispatcher-free) flow toggle — inlined into client bundles so
# lib/protocol/session.ts takes the sortition bootstrap path. Must be declared
# here (not just passed as a compose build arg): an undeclared ARG is discarded
# by Docker, so `next build` would never see it and the flag would silently
# resolve to undefined (false) in the browser.
ARG NEXT_PUBLIC_SORTITION_ENABLED
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_EXPLORER_URL
ARG NEXT_PUBLIC_TTS_MODEL_ID
ENV NEXT_PUBLIC_USE_PROTOCOL=${NEXT_PUBLIC_USE_PROTOCOL} \
    NEXT_PUBLIC_LCAI_IS_TESTNET=${NEXT_PUBLIC_LCAI_IS_TESTNET} \
    NEXT_PUBLIC_CONSUMER_API_URL=${NEXT_PUBLIC_CONSUMER_API_URL} \
    NEXT_PUBLIC_PROJECT_ID=${NEXT_PUBLIC_PROJECT_ID} \
    NEXT_PUBLIC_JOB_REGISTRY_ADDRESS=${NEXT_PUBLIC_JOB_REGISTRY_ADDRESS} \
    NEXT_PUBLIC_AI_CONFIG_ADDRESS=${NEXT_PUBLIC_AI_CONFIG_ADDRESS} \
    NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS=${NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS} \
    NEXT_PUBLIC_RELAY_URL=${NEXT_PUBLIC_RELAY_URL} \
    NEXT_PUBLIC_RPC_URL=${NEXT_PUBLIC_RPC_URL} \
    NEXT_PUBLIC_SORTITION_ENABLED=${NEXT_PUBLIC_SORTITION_ENABLED} \
    NEXT_PUBLIC_CHAIN_ID=${NEXT_PUBLIC_CHAIN_ID} \
    NEXT_PUBLIC_EXPLORER_URL=${NEXT_PUBLIC_EXPLORER_URL} \
    NEXT_PUBLIC_TTS_MODEL_ID=${NEXT_PUBLIC_TTS_MODEL_ID}

COPY . .
# Skip next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime stage ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Copy everything the Next.js production server needs. `next start` reads
# .next/, node_modules, public/, package.json. The standalone optimization is
# intentionally left off so this Dockerfile doesn't require upstream config
# changes; image size can be reduced later by enabling `output: 'standalone'`.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder /app/lib/db/migrate.ts ./lib/db/migrate.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000
# Run next directly: `pnpm start` depends on the corepack shim resolving a
# pnpm version at container start (no packageManager field is pinned), which
# fails in the bare image. The compose override has always used this path;
# make it the image default so the image runs correctly without an override.
CMD ["node_modules/.bin/next", "start"]
