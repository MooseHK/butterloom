# ── Stage 1: install dependencies ────────────────────────────────────
FROM node:22-slim AS deps

# node-gyp needs Python + C++ toolchain to build better-sqlite3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ────────────────────────────────────────
FROM node:22-slim AS runtime

# libvips for image encoding (AVIF / WebP / JPEG derivatives)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libvips-tools && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source and drizzle migrations
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

# Persistent data lives here — mount a volume at /app/var
RUN mkdir -p /app/var/media

EXPOSE 3000

CMD ["npx", "tsx", "src/server.tsx"]
