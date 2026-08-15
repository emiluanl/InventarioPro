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
# better-sqlite3 (dependencia de @prisma/adapter-better-sqlite3) no trae prebuild
# para node 20.x en slim: se compila desde fuente con node-gyp. Necesitamos
# python3 + build-essential AQUÍ; se purgan después del npm ci (el binario
# compilado queda en node_modules y el runtime solo necesita libstdc++6,
# que ya trae la imagen base de Node).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# --omit=optional también: prisma es peer opcional de @prisma/client (devOptional
# en el lock) y npm solo lo excluye si se omiten dev Y optional a la vez. Sin
# esto, el CLI de Prisma (con Studio) volvería a colarse en la imagen runtime.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
    && apt-get purge -y --auto-remove build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# ---- build stage ----
FROM node:20-slim AS builder
WORKDIR /app

# Mismo motivo que en deps: el npm ci completo también compila better-sqlite3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
RUN npm ci --no-audit --no-fund \
    && apt-get purge -y --auto-remove build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

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

# Solo lo que `migrate deploy` necesita: el CLI de prisma (que en v7 arrastra
# @prisma/studio-core como dependencia obligatoria) y dotenv (lo importa
# prisma.config.ts). Nada de las deps de la app (nest, express, @prisma/client).
# --no-package-lock: sin el lock del proyecto (que marca prisma como
# devOptional y npm no lo instalaría); instalar en el WORKDIR crea un
# package.json privado con solo estas dos deps.
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock prisma@7.9.1 dotenv

COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

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
