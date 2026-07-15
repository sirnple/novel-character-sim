# Build stage
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-slim AS runner
WORKDIR /app

# better-sqlite3 may need runtime libs; keep slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Native module (ensure present even if standalone trace misses it)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Agent prompts loaded at runtime via fs from process.cwd()/src/core/prompts
COPY --from=builder /app/src/core/prompts ./src/core/prompts

# Create public dir if not exists (Next.js standalone needs it)
RUN mkdir -p /app/public
# Data directory for SQLite (mount Railway Volume at /app/data)
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data /app/src

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
