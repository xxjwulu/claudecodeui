# syntax=docker/dockerfile:1
#
# Multi-stage Dockerfile for CloudCLI UI.
# Build the image once (e.g. in Aliyun ACR automated build) and ship to any
# Linux x64 host. The final image has only runtime deps — no toolchain,
# no source tree, ~250 MB.
#
# Build:
#   docker build -t cloudcli:latest .
# Run:
#   docker run -d --name cloudcli -p 3001:3001 \
#     -v /root/.claude:/root/.claude \
#     -v /root/.cloudcli:/root/.cloudcli \
#     cloudcli:latest

# ---------------------------------------------------------------------------
# Stage 1: builder — full toolchain so native modules can compile if their
# prebuilt binary fails to download. Output: compiled dist/, dist-server/,
# and a node_modules pruned to production deps.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

# python3/make/g++ are needed only if a native module's prebuilt binary
# misses (e.g. an unreleased Node ABI). They are not carried into runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        git \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Use the China mirror by default; ACR build machines run in mainland CN
# and reach npmmirror.com over low-latency internal paths. Override by
# passing --build-arg NPM_REGISTRY=... if you build outside China.
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "$NPM_REGISTRY"

WORKDIR /app

# Copy only manifests first to maximise Docker layer cache hits.
COPY package*.json ./

# Install everything (including devDeps — we need them to run vite build
# and tsc). better-sqlite3's prebuild-install will fetch the linux-x64
# binary from the same mirror; fall back to source compile if it 404s.
RUN npm_config_better_sqlite3_binary_host_mirror="https://registry.npmmirror.com/-/binary/better-sqlite3" \
    npm install --no-audit --no-fund

# Copy the rest of the source and build client + server.
COPY . .
RUN npm run build

# Strip devDependencies — runtime image only needs production deps.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime — minimal image, just the compiled artifacts + prod deps.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# tini reaps zombie processes (node-pty spawns children); ca-certificates
# is needed for any outbound TLS call the server makes.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what the runtime needs. Order matters for layer cache: put
# rarely-changing node_modules first so source changes don't invalidate it.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/public ./public
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server
COPY --from=builder /app/electron ./electron
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
# CloudCLI defaults — match the .env.example. Override via `docker run -e`.
ENV SERVER_PORT=3001 \
    HOST=0.0.0.0

EXPOSE 3001

# tini handles SIGTERM cleanly so `docker stop` doesn't hang on a busy server.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "server"]
