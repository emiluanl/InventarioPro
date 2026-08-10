# =============================================================================
# InventarioPro - Backend Dockerfile (multi-stage)
# =============================================================================

# ---- Build stage ----
FROM node:20-slim AS builder
WORKDIR /app

# openssl es necesario para que Prisma detecte el engine correcto al generar.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
RUN npm ci

COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# openssl en runtime: los engines de Prisma hacen dlopen de libssl en caliente.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copiamos solo lo necesario
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# Usuario no-root
RUN groupadd -r app && useradd -r -g app app

# El CLI de Prisma (migrate deploy) escribe en estos directorios: el usuario
# no-root necesita permisos, si no falla con "Can't write to @prisma/engines".
RUN chown -R app:app /app/node_modules/.prisma /app/node_modules/@prisma/engines
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migraciones + arranque: aplica el esquema ANTES de servir, para que el
# seed de categorías del sistema (BootstrapService) encuentre las tablas.
# El comando es idempotente: si no hay migraciones nuevas, no hace nada.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
