# Control de facturas de faena

Sistema web para que el frigorífico cargue los PDF de sus facturas (ARCA, tipo A), vea los datos
principales en una tabla de control sin abrir cada PDF, y lleve el control de pagos y vencimientos.

Monorepo (pnpm workspaces):

- `apps/api` — NestJS + Prisma (PostgreSQL). Puerto 4000.
- `apps/web` — Next.js (App Router) + Tailwind. Puerto 3000. Reenvía `/api/*` a la API, así las
  cookies de sesión quedan en el mismo dominio que la web.

Ver [CLAUDE.md](CLAUDE.md) para el alcance, el modelo de datos y el plan por fases.

## Desarrollo

Requisitos: Node.js 24+, pnpm 12+ y Docker Desktop.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:up
pnpm --filter api db:migrate
pnpm --filter api db:seed
pnpm dev
```

Antes del seed, completá en `apps/api/.env` los secretos `JWT_*` y los datos del primer ADMIN
(`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`). El seed solo crea el ADMIN si todavía no hay ninguno;
los demás usuarios se crean desde la pantalla **Usuarios**.

- Web: http://localhost:3000
- API: http://localhost:4000/health
- Postgres de Docker: puerto **5440** (para no chocar con otros Postgres locales).

### Comandos

| Comando                                  | Qué hace                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                               | Levanta API y web en modo desarrollo                            |
| `pnpm db:up` / `pnpm db:down`            | Levanta / baja Postgres en Docker                               |
| `pnpm lint`                              | Lint de ambas apps                                              |
| `pnpm test`                              | Tests unitarios de ambas apps                                   |
| `pnpm --filter api test:e2e`             | Tests end-to-end de la API (requieren la base levantada)        |
| `pnpm build`                             | Build de producción                                             |
| `pnpm format`                            | Prettier sobre todo el repo                                     |
| `pnpm --filter api db:migrate`           | Crea/aplica migraciones y regenera el cliente de Prisma         |
| `pnpm --filter api db:seed`              | Crea el primer ADMIN si no existe                               |
| `pnpm --filter api db:seed-demo [N]`     | Carga N facturas ficticias (por defecto 500, P.V. 00090)        |
| `pnpm --filter api db:clear-demo`        | Borra solo las facturas ficticias                               |
| `scripts/backup.sh`                      | Backup de la base y los PDFs en `backups/<fecha-hora>/`         |
| `scripts/verify-backup.sh [carpeta]`     | Simulacro: restaura un backup en una base temporal y lo compara |
| `scripts/restore.sh <carpeta> [--force]` | Restaura un backup (ver más abajo)                              |
| `scripts/backup-railway.sh`              | Copia a la PC la base y los PDFs de producción y los verifica   |

### Tests del lector de PDFs

Los PDFs reales no se versionan (tienen datos de clientes). Ver [fixtures/README.md](fixtures/README.md).
Sin ellos, los tests que los usan se saltean; el resto usa PDFs sintéticos con datos ficticios.

## Producción

La API valida su configuración al arrancar y no levanta si falta algo crítico (por ejemplo,
secretos cortos o `WEB_ORIGIN` en producción). Las cookies de sesión son `httpOnly`, `secure` y
`sameSite=lax`; la API manda headers de seguridad (helmet) y responde los errores en español sin
filtrar detalles internos.

### Opción A — Servidor propio (VPS) con HTTPS automático

Necesitás un servidor con Docker y un dominio apuntando a su IP.

```bash
cp .env.prod.example .env.prod      # completar: dominio, claves, secretos, ADMIN
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

- [Caddy](deploy/Caddyfile) obtiene y renueva el certificado HTTPS (Let's Encrypt) solo.
- Solo Caddy expone puertos (80/443); la base y la API quedan en la red interna.
- Los PDFs viven en el volumen `pdfs`; la base, en `pgdata`.
- Al arrancar, la API aplica las migraciones y, si están `SEED_ADMIN_EMAIL` y
  `SEED_ADMIN_PASSWORD`, crea el primer ADMIN (solo si no hay ninguno). Después de crearlo,
  conviene borrar `SEED_ADMIN_PASSWORD` del entorno.

### Opción B — Railway (es la que está en uso)

Producción actual: **https://web-production-b2f79abe.up.railway.app** (proyecto `frigorifico`).

| Servicio   | Origen                                             | Notas                                                                 |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `Postgres` | Base administrada de Railway (Postgres 18)         | Sin acceso público                                                    |
| `api`      | `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`      | Volumen en `/data/storage` (PDFs), `RAILWAY_RUN_UID=0`, sin dominio   |
| `web`      | `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile`      | `API_URL=http://api.railway.internal:4000`, dominio público con HTTPS |
| `backup`   | `RAILWAY_DOCKERFILE_PATH=deploy/backup/Dockerfile` | Volumen en `/backups`; backup diario de la base, verificado           |

Variables de `api`: `NODE_ENV=production`, `PORT=4000`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
`WEB_ORIGIN`, `ISSUER_CUIT`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`,
`JWT_REFRESH_TTL`, `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR=/data/storage`. Los secretos y la clave
del ADMIN están en `.env.railway` (local, no se versiona).

`RAILWAY_RUN_UID=0` hace falta porque los volúmenes de Railway pertenecen a root.

Para desplegar una versión nueva (desde la raíz del repo, con la CLI de Railway logueada):

```bash
railway up --service api --ci
railway up --service web --ci
```

### Generar secretos

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Backups

Un backup = la base (`pg_dump`) + todos los PDFs + un manifiesto con conteos y hashes. Los
scripts usan `pg_dump`/`psql` del sistema o, si no están, los corren dentro de Docker.

```bash
scripts/backup.sh                 # crea backups/<fecha-hora>/ y conserva los últimos 14
scripts/verify-backup.sh          # restaura el último en una base temporal y lo compara
```

**Probá la restauración periódicamente** con `verify-backup.sh`: un backup que no se restauró
nunca no es un backup. El simulacro no toca la base ni los PDFs reales.

Para restaurar de verdad (por ejemplo, en un servidor nuevo):

```bash
TARGET_DATABASE_URL=postgresql://... TARGET_STORAGE_DIR=/ruta/a/los/pdfs \
  scripts/restore.sh backups/20261113-155602
```

Si la base destino ya tiene facturas, se niega; con `--force` reemplaza todo.

### Backups en el servidor (opción A)

La base no expone puertos: se le llega por la red de Docker. En el servidor, por ejemplo con cron
todos los días a las 3:00:

```bash
0 3 * * * cd /ruta/frigorifico && \
  PG_DOCKER_ARGS="--network frigorifico_default" \
  DATABASE_URL="postgresql://USUARIO:CLAVE@db:5432/frigorifico" \
  STORAGE_DIR=/var/lib/docker/volumes/frigorifico_pdfs/_data \
  scripts/backup.sh >> backups/backup.log 2>&1
```

Copiá la carpeta `backups/` fuera del servidor (otro disco, un bucket o tu PC): un backup en el
mismo servidor no sirve si se pierde el servidor.

### Backups en Railway (opción B, en uso)

El servicio `backup` ([deploy/backup](deploy/backup)) hace un `pg_dump` al arrancar y cada 24 h en
su volumen `/backups`, conserva los últimos 14 y, **después de cada backup, lo restaura en una
base temporal del mismo servidor y compara** usuarios, facturas, importes, kg, pagos, historial y
migraciones. El resultado queda en los logs (`Restauración verificada OK: ...`) y en el
`manifest.txt` de cada backup (`verificado=ok`):

```bash
railway logs --service backup
```

Ese servicio no ve los **PDFs** (están en el volumen de `api`). Para tener una copia completa
**fuera de Railway**, correr en la PC (recomendado: una vez por semana):

```bash
scripts/backup-railway.sh
```

Baja el último backup verificado de la base y todos los PDFs a `backups/railway-<fecha-hora>/`
(mismo formato que los backups locales) y hace el simulacro de restauración en un Postgres 18
temporal en Docker. Necesita la CLI de Railway logueada y la clave SSH registrada en la cuenta
(`railway ssh keys list`; la de esta PC es `~/.ssh/id_ed25519`).

Para recuperar producción desde una copia (desastre), restaurar el dump en la base de Railway
con `scripts/restore.sh` (por un túnel: `railway connect Postgres --tunnel-only`) y subir los PDFs
al volumen con `railway volume files --volume api-volume upload <carpeta> /`.

> **Ojo con Git Bash en Windows:** convierte los valores que empiezan con `/` en rutas de Windows
> (`/data/storage` → `C:/Program Files/Git/data/storage`). Al pasar rutas a la CLI de Railway,
> anteponer `MSYS_NO_PATHCONV=1`.
