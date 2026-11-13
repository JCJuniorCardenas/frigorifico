#!/usr/bin/env bash
# Simulacro de restauración: restaura un backup en una base y carpeta TEMPORALES y compara
# contra lo que dice su manifiesto. No toca la base ni los PDFs reales.
#
# Uso:  scripts/verify-backup.sh [backups/<fecha-hora>]   (por defecto, el más reciente)
# Necesita poder crear una base nueva en el mismo servidor de DATABASE_URL.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT="$(repo_root)"
SRC="${1:-$(ls -1d "$ROOT"/backups/*/ 2>/dev/null | LC_ALL=C sort | tail -1)}"
SRC="${SRC%/}"
[ -n "$SRC" ] && [ -f "$SRC/manifest.txt" ] || die "No hay backup para verificar."
SCRATCH_DB="frigorifico_restore_check"
SCRATCH_DIR="$(mktemp -d)"
CONTAINER=""

if [ -n "${VERIFY_PG_IMAGE:-}" ]; then
  # Simulacro en un Postgres temporal de la versión indicada (ej. postgres:18-alpine para los
  # backups de Railway), que se borra al terminar.
  export PG_IMAGE="$VERIFY_PG_IMAGE"
  PORT="${VERIFY_PG_PORT:-5499}"
  info "Levantando $VERIFY_PG_IMAGE temporal en el puerto $PORT..."
  CONTAINER="$(docker run -d --rm -e POSTGRES_PASSWORD=restore-check -p "127.0.0.1:$PORT:5432" "$VERIFY_PG_IMAGE")"
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 2
  BASE_URL="postgresql://postgres:restore-check@localhost:$PORT/postgres"
else
  DATABASE_URL="${DATABASE_URL:-$(env_from_api DATABASE_URL)}"
  BASE_URL="$(clean_url "$DATABASE_URL")"
fi
SCRATCH_URL="${BASE_URL%/*}/$SCRATCH_DB"

cleanup() {
  if [ -n "$CONTAINER" ]; then
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
  else
    pg_tool psql "$BASE_URL" -q -c "drop database if exists $SCRATCH_DB" >/dev/null 2>&1 || true
  fi
  rm -rf "$SCRATCH_DIR"
}
trap cleanup EXIT

info "Verificando $SRC"
pg_tool psql "$BASE_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists $SCRATCH_DB" -c "create database $SCRATCH_DB"
TARGET_DATABASE_URL="$SCRATCH_URL" TARGET_STORAGE_DIR="$SCRATCH_DIR" "$ROOT/scripts/restore.sh" "$SRC" > "$SCRATCH_DIR.log" 2>&1 \
  || { cat "$SCRATCH_DIR.log"; die "La restauración falló."; }

expected="$(grep -E '^(users|invoices|paid|status_logs|migrations)=' "$SRC/manifest.txt")"
actual="$(db_fingerprint "$SCRATCH_URL")"
if [ "$expected" != "$actual" ]; then
  echo "Esperado:"; echo "$expected"; echo "Restaurado:"; echo "$actual"
  die "Los datos restaurados no coinciden con el backup."
fi
pdfs_expected="$(grep '^pdfs=' "$SRC/manifest.txt" | cut -d= -f2)"
pdfs_actual="$(find "$SCRATCH_DIR" -type f | wc -l | tr -d ' ')"
[ "$pdfs_expected" = "$pdfs_actual" ] || die "PDFs: se esperaban $pdfs_expected y se restauraron $pdfs_actual."
rm -f "$SCRATCH_DIR.log"

echo "$actual"
echo "pdfs=$pdfs_actual (contenido verificado con sha256)"
info "OK: el backup se restauró completo y coincide con el original."
