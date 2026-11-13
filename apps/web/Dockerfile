# Imagen de producción de la web. Construir desde la raíz del repo:
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t frigorifico-web .
# API_URL es la dirección INTERNA de la API (la web le reenvía /api/*). Se fija al construir.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
WORKDIR /repo/apps/web
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
