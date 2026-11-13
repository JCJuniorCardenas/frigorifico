#!/usr/bin/env bash
# Restaura un backup hecho con scripts/backup.sh.
#
# Uso:  TARGET_DATABASE_URL=... TARGET_STORAGE_DIR=... scripts/restore.sh backups/<fecha-hora> [--force]
#
# Por seguridad NO restaura sobre una base que ya tiene facturas, salvo con --force
# (en ese caso REEMPLAZA todos los datos de la base y los PDFs de la carpeta destino).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SRC="${1:-}"
FORCE="${2:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "Indicá la carpeta del backup (ej. backups/20261113-120000)."
[ -f "$SRC/db.dump" ] && [ -f "$SRC/pdfs.tar.gz" ] || die "Al backup le falta db.dump o pdfs.tar.gz."
[ -n "${TARGET_DATABASE_URL:-}" ] || die "Falta TARGET_DATABASE_URL (base destino)."
[ -n "${TARGET_STORAGE_DIR:-}" ] || die "Falta TARGET_STORAGE_DIR (carpeta destino de los PDFs)."
URL="$(clean_url "$TARGET_DATABASE_URL")"

existing="$(pg_tool psql "$URL" -At -c 'select count(*) from "Invoice"' 2>/dev/null || echo 0)"
if [ "${existing:-0}" != "0" ] && [ "$FORCE" != "--force" ]; then
  die "La base destino ya tiene $existing facturas. Usá --force para reemplazarla."
fi

info "Restaurando la base..."
pg_tool pg_restore --dbname="$URL" --clean --if-exists --no-owner --no-privileges --exit-on-error < "$SRC/db.dump"

info "Restaurando los PDFs en $TARGET_STORAGE_DIR..."
mkdir -p "$TARGET_STORAGE_DIR"
if [ "$FORCE" = "--force" ]; then find "$TARGET_STORAGE_DIR" -mindepth 1 -delete; fi
tar -xzf "$SRC/pdfs.tar.gz" -C "$TARGET_STORAGE_DIR"

info "Verificando..."
if [ -f "$SRC/pdfs.sha256" ]; then
  diff <(hash_tree "$TARGET_STORAGE_DIR") "$SRC/pdfs.sha256" >/dev/null || die "Los PDFs restaurados no coinciden con el backup."
fi
db_fingerprint "$URL"
info "Restauración completa."
