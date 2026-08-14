# =============================================================================
# InventarioPro - Backend Dockerfile (multi-stage)
#
# Cuatro stages:
#   deps    -> node_modules SOLO de producción (npm ci --omit=dev): sin el CLI
#              de Prisma (prisma/engines/studio/typescript se fueron a
#              devDependencies). El runtime solo necesita @prisma/client +
#              @prisma/adapter-pg, que siguen en dependencies.
#   builder -> compila dist/ con todas las deps (nest build necesita las devDeps)
#   migrate -> job one-shot que aplica `prisma migrate deploy` ANTES de que el
#              backend sirva (el CLI vive aquí, no en la imagen runtime).
#   runtime -> imagen final: node_modules de 'deps' + dist/ de 'builder'.
# =============================================================================

# ---- deps stage: dependencias de producción limpias ----
FROM node:20-slim AS deps
WORKDIR /app

# openssl es necesario para que Prisma detecte el engine correcto al generar.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# --omit=optional también: prisma es peer opcional de @prisma/client (devOptional
# en el lock) y npm solo lo excluye si se omiten dev Y optional a la vez. Sin
# esto, el CLI de Prisma (con Studio) volvería a colarse en la imagen runtime.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

# ---- build stage ----
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
RUN npm ci --no-audit --no-fund

COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# ---- migrate stage: job one-shot de migraciones (no sirve la API) ----
FROM node:20-slim AS migrate
WORKDIR /app

ENV NODE_ENV=production

# openssl en runtime: los engines de Prisma hacen dlopen de libssl en caliente.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Parte del node_modules de producción limpio (stage deps) y añade SOLO el CLI
# de prisma. Se instala aislado en /tmp con un package.json mínimo (sin el
# lock del proyecto — que marca prisma como devOptional y npm no lo instala —
# y sin las devDeps, que npm reinstalaría con el package.json del proyecto).
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p /tmp/prisma-cli && cd /tmp/prisma-cli && \
    echo '{"name":"prisma-cli","private":true,"dependencies":{"prisma":"7.9.1"}}' > package.json && \
    npm install --no-audit --no-fund --no-package-lock && \
    cp -r node_modules/. /app/node_modules/
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY package.json ./

# Usuario no-root
RUN groupadd -r app && useradd -r -g app app

# El CLI de Prisma (migrate deploy) escribe en estos directorios: el usuario
# no-root necesita permisos, si no falla con "Can't write to @prisma/engines".
RUN chown -R app:app /app/node_modules/.prisma /app/node_modules/@prisma/engines 2>/dev/null || true
USER app

# One-shot: aplica las migraciones pendientes y sale. El backend espera este
# job con `depends_on: migrate: condition: service_completed_successfully`.
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime stage: imagen final del backend ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# openssl en runtime: los engines de Prisma hacen dlopen de libssl en caliente.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Solo lo necesario: deps de producción limpias (stage deps) + build (builder).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY package.json ./

# Usuario no-root
RUN groupadd -r app && useradd -r -g app app

# Con Prisma 7 el cliente se genera en src/generated (ya no en .prisma), así
# que el chown tolera directorios ausentes.
RUN chown -R app:app /app/node_modules/.prisma /app/node_modules/@prisma/engines 2>/dev/null || true
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Las migraciones las aplica el job 'migrate' (compose), no este contenedor.
CMD ["node", "dist/main.js"]
