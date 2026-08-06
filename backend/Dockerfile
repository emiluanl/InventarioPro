# =============================================================================
# InventarioPro - Backend Dockerfile (multi-stage)
# =============================================================================

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json nest-cli.json ./
RUN npm ci

COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copiamos solo lo necesario
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# Usuario no-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3001

# Healthcheck: el endpoint /api/auth/me devuelve 401 sin auth,
# pero está vivo. Para un check más limpio, añadir un endpoint /health
# en el futuro.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/auth/me || exit 1

CMD ["node", "dist/src/main.js"]
