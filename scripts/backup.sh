#!/usr/bin/env bash
# Backup de la base (pg_dump) y de los PDFs (tar.gz) en backups/<fecha-hora>/.
#
# Uso:  scripts/backup.sh
# Variables (opcionales; por defecto toma apps/api/.env):
#   DATABASE_URL   base a respaldar
#   STORAGE_DIR    carpeta de PDFs (por defecto apps/api/storage)
#   BACKUP_DIR     destino (por defecto ./backups)
#   KEEP           cuántos backups conservar (por defecto 14; 0 = todos)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT="$(repo_root)"
DATABASE_URL="${DATABASE_URL:-$(env_from_api DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || die "Falta DATABASE_URL."
STORAGE_DIR="${STORAGE_DIR:-$ROOT/apps/api/$(env_from_api STORAGE_LOCAL_DIR | sed 's#^\./##')}"
[ "$STORAGE_DIR" != "$ROOT/apps/api/" ] || STORAGE_DIR="$ROOT/apps/api/storage"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${KEEP:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
URL="$(clean_url "$DATABASE_URL")"

info "Respaldando la base..."
pg_tool pg_dump "$URL" --format=custom --no-owner --no-privileges > "$DEST/db.dump"
[ -s "$DEST/db.dump" ] || die "El dump de la base quedó vacío."

info "Respaldando los PDFs de $STORAGE_DIR..."
mkdir -p "$STORAGE_DIR"
tar -czf "$DEST/pdfs.tar.gz" -C "$STORAGE_DIR" .

info "Escribiendo el manifiesto..."
{
  echo "fecha=$STAMP"
  db_fingerprint "$URL"
  echo "pdfs=$(find "$STORAGE_DIR" -type f | wc -l | tr -d ' ')"
  echo "db.dump sha256=$(sha256_of "$DEST/db.dump")"
  echo "pdfs.tar.gz sha256=$(sha256_of "$DEST/pdfs.tar.gz")"
} > "$DEST/manifest.txt"
hash_tree "$STORAGE_DIR" > "$DEST/pdfs.sha256"

if [ "$KEEP" -gt 0 ]; then
  ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | LC_ALL=C sort | head -n -"$KEEP" | while read -r old; do
    info "Borrando backup viejo $old"
    rm -rf "$old"
  done
fi

info "Backup listo en $DEST"
cat "$DEST/manifest.txt"
