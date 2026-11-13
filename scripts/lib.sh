#!/usr/bin/env bash
# Funciones compartidas por los scripts de backup. No ejecutar directamente.
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

# Lee una variable de apps/api/.env si no está en el entorno.
env_from_api() {
  local key="$1" file
  file="$(repo_root)/apps/api/.env"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

repo_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }

# pg_dump / pg_restore / psql: usa los del sistema si existen; si no, los de una imagen de Postgres.
# En modo Docker, "localhost" de la URL se reemplaza por el host de Docker.
pg_tool() {
  local tool="$1"; shift
  if command -v "$tool" >/dev/null 2>&1; then
    "$tool" "$@"
  else
    command -v docker >/dev/null 2>&1 || die "No se encontró $tool ni Docker para correrlo."
    local args=()
    for a in "$@"; do args+=("$(echo "$a" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#')"); done
    # PG_DOCKER_ARGS permite, por ejemplo, "--network frigorifico_default" para llegar a la base
    # de docker-compose.prod.yml (que no expone puertos).
    # shellcheck disable=SC2086
    MSYS_NO_PATHCONV=1 docker run --rm -i --add-host=host.docker.internal:host-gateway ${PG_DOCKER_ARGS:-} "$PG_IMAGE" "$tool" "${args[@]}"
  fi
}

# pg_dump no acepta el parámetro ?schema= de Prisma: se quita la query string.
clean_url() { echo "${1%%\?*}"; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Lista "sha256  ruta" de todos los archivos de una carpeta, ordenada.
hash_tree() {
  local dir="$1"
  (cd "$dir" && find . -type f | LC_ALL=C sort | while read -r f; do echo "$(sha256_of "$f")  ${f#./}"; done)
}

# Resumen de la base para comparar origen y restauración.
db_fingerprint() {
  local url="$1"
  pg_tool psql "$url" -At -v ON_ERROR_STOP=1 -c "
    select 'users=' || count(*) from \"User\";
    select 'invoices=' || count(*) || ' total=' || coalesce(sum(\"totalAmount\"), 0) || ' kg=' || coalesce(sum(\"slaughterKg\"), 0) from \"Invoice\";
    select 'paid=' || count(*) from \"Invoice\" where status = 'PAID';
    select 'status_logs=' || count(*) from \"InvoiceStatusLog\";
    select 'migrations=' || count(*) from \"_prisma_migrations\";"
}
