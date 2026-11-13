# Imagen de producción de la API. Construir desde la raíz del repo:
#   docker build -f apps/api/Dockerfile -t frigorifico-api .
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Solo para `prisma generate` al construir; la URL real se pasa al correr el contenedor.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# El postinstall de la API corre `prisma generate`: necesita el schema antes de instalar.
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN pnpm exec prisma generate && pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=4000 STORAGE_LOCAL_DIR=/data/storage
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/prisma /repo/apps/api/prisma
# Cliente generado: lo usa el seed del primer ADMIN (`pnpm db:seed`, corre con tsx).
COPY --from=build /repo/apps/api/src/generated /repo/apps/api/src/generated
COPY --from=build /repo/apps/api/prisma.config.ts /repo/apps/api/package.json /repo/apps/api/
WORKDIR /repo/apps/api
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
# Los PDFs van en /data/storage: montar ahí un volumen persistente (Railway Volume o el de compose).
EXPOSE 4000
# Aplica las migraciones pendientes y arranca.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
