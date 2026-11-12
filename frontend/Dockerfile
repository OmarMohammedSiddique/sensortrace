# syntax=docker/dockerfile:1.7
# SensorTrace frontend: Next.js standalone server.
# Build context: the repository root's `frontend/` directory.
#   docker build -t sensortrace-frontend ./frontend
#   docker run -p 3100:3100 -e API_INTERNAL_URL=http://api:8100 sensortrace-frontend
#
# API_INTERNAL_URL is read at RUNTIME by the proxy route (src/app/api/v1/[...path]/route.ts),
# so one image works against any backend. Nothing is fetched from the network at build
# time except npm packages: fonts ship inside the `geist` package.

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies ----------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build -----------------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# ---- runtime ---------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    API_INTERNAL_URL=http://127.0.0.1:8100

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# The standalone output contains server.js and only the node_modules it needs.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
