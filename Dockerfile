# Establo — production image (Fly.io / any container host)
# Multi-stage: install deps → build the dashboard → slim runtime.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── deps: full install (dev deps needed for the vite build) ─────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── build: compile the dashboard to dist/web ────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm typecheck && pnpm build

# ── prod-deps: production-only node_modules for the runtime image ───────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY prompts ./prompts
COPY evals ./evals

# DATA_DIR should point at a mounted volume in production (see fly.toml).
EXPOSE 8787
CMD ["pnpm", "start"]
