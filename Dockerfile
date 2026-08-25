# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/app/.data/uploads
RUN addgroup -S hexprocure && adduser -S hexprocure -G hexprocure \
    && mkdir -p /app/.data/uploads && chown -R hexprocure:hexprocure /app/.data
COPY --from=builder --chown=hexprocure:hexprocure /app/.next/standalone ./
COPY --from=builder --chown=hexprocure:hexprocure /app/.next/static ./.next/static
COPY --from=builder --chown=hexprocure:hexprocure /app/public ./public
COPY --from=builder --chown=hexprocure:hexprocure /app/drizzle ./drizzle
COPY --from=builder --chown=hexprocure:hexprocure /app/scripts/migrate.mjs ./scripts/migrate.mjs
USER hexprocure
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
