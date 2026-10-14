# Imagen de producción de la API de Cozy (multi-etapa).
#   docker build -t cozy-api .
#   docker run -p 3000:3000 --env-file .env cozy-api
# Al arrancar aplica las migraciones pendientes y luego inicia la aplicación.

# ── Etapa 1: dependencias de producción (sin herramientas de desarrollo) ─────────────────────────
FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Etapa 2: compilación con tsc (vía nest build) ────────────────────────────────────────────────
FROM node:22-alpine AS compilacion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Etapa 3: imagen final, solo lo necesario para correr ─────────────────────────────────────────
FROM node:22-alpine AS produccion
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=dependencias /app/node_modules ./node_modules
COPY --chown=node:node --from=compilacion /app/dist ./dist

# Usuario sin privilegios (viene con la imagen de node)
USER node

EXPOSE 3000

# Responde 200 solo si la API y la base de datos contestan
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 1) migration:run con el build compilado (dist/database/data-source.js); si falla, el contenedor no arranca.
# 2) exec reemplaza al shell por node, así SIGTERM llega a la aplicación y se cierra ordenadamente.
CMD ["sh", "-c", "node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run && exec node dist/main"]
