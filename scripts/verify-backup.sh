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
DATABASE_URL="${DATABASE_URL:-$(env_from_api DATABASE_URL)}"
BASE_URL="$(clean_url "$DATABASE_URL")"
SCRATCH_DB="frigorifico_restore_check"
SCRATCH_URL="${BASE_URL%/*}/$SCRATCH_DB"
SCRATCH_DIR="$(mktemp -d)"

cleanup() {
  pg_tool psql "$BASE_URL" -q -c "drop database if exists $SCRATCH_DB" >/dev/null 2>&1 || true
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
