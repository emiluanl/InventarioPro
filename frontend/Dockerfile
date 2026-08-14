# =============================================================================
# InventarioPro - Frontend Dockerfile (multi-stage)
# =============================================================================
# Con output: 'standalone' (next.config.js), el build produce .next/standalone
# con el servidor mínimo y un node_modules podado SIN devDeps (typescript,
# eslint, vitest…). El runtime copia solo eso + static + public: la imagen baja
# de ~980MB (todo node_modules) a ~250MB.
# =============================================================================

# ---- Deps stage ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_API_URL se inlinea en el bundle del cliente en BUILD TIME,
# por eso se inyecta como ARG en el stage de build (ver docker-compose).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

# Solo el standalone (servidor + node_modules podado), los estáticos y public.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
