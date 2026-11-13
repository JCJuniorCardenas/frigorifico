# Control de facturas de faena

Monorepo (pnpm workspaces) con:

- `apps/api` — NestJS + Prisma (PostgreSQL). Puerto 4000.
- `apps/web` — Next.js (App Router) + Tailwind. Puerto 3000.

Ver [CLAUDE.md](CLAUDE.md) para el alcance, modelo de datos y plan por fases.

## Requisitos

- Node.js 24+, pnpm 12+
- Docker Desktop (para Postgres local)

## Primer arranque

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:up
pnpm dev
```

- Web: http://localhost:3000 (muestra si la API y la base están conectadas)
- API: http://localhost:4000/health

## Scripts

| Comando                        | Qué hace                             |
| ------------------------------ | ------------------------------------ |
| `pnpm dev`                     | Levanta API y web en modo desarrollo |
| `pnpm db:up` / `pnpm db:down`  | Levanta / baja Postgres en Docker    |
| `pnpm lint`                    | Lint de ambas apps                   |
| `pnpm test`                    | Tests unitarios                      |
| `pnpm build`                   | Build de producción                  |
| `pnpm format`                  | Prettier sobre todo el repo          |
| `pnpm --filter api db:migrate` | Crea/aplica migraciones de Prisma    |
