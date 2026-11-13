#!/usr/bin/env bash
# Copia a esta PC un backup completo de PRODUCCIÓN (Railway): el último dump de la base que hizo
# el servicio `backup` (ya verificado allá) + todos los PDFs del volumen de la API.
# Deja backups/railway-<fecha-hora>/ con el mismo formato que scripts/backup.sh, así se puede
# probar con scripts/verify-backup.sh y restaurar con scripts/restore.sh.
#
# Uso:  scripts/backup-railway.sh            (después corre el simulacro de restauración local)
#       VERIFY=0 scripts/backup-railway.sh   (sin simulacro)
# Requiere: CLI de Railway logueada y vinculada al proyecto, y la clave SSH registrada
# (`railway ssh keys list`).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT="$(repo_root)"
cd "$ROOT"
command -v railway >/dev/null 2>&1 || die "No está instalada la CLI de Railway."
BACKUP_VOLUME="${BACKUP_VOLUME:-backup-volume}"
PDF_VOLUME="${PDF_VOLUME:-api-volume}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/railway-$STAMP"
TMP="$DEST/.tmp"
mkdir -p "$TMP"

# Hasta 3 intentos: la conexión SFTP con Railway a veces se corta.
vol() {
  local i
  for i in 1 2 3; do
    MSYS_NO_PATHCONV=1 railway volume files --volume "$1" "${@:2}" && return 0
    echo "(reintento $i de 3)" >&2
    sleep 5
  done
  return 1
}

info "Buscando el último backup de la base en $BACKUP_VOLUME..."
latest="$(vol "$BACKUP_VOLUME" list / 2>/dev/null | tr -s ' \t' '\n' | grep -E '^[0-9]{8}-[0-9]{6}/$' | LC_ALL=C sort | tail -1)"
latest="${latest%/}"
[ -n "$latest" ] || die "No hay backups de la base en $BACKUP_VOLUME."
info "Bajando el backup $latest..."
vol "$BACKUP_VOLUME" download "/$latest" "$TMP/db" >/dev/null
[ -s "$TMP/db/db.dump" ] && [ -s "$TMP/db/manifest.txt" ] || die "El backup $latest está incompleto."
grep -q '^verificado=ok' "$TMP/db/manifest.txt" || die "El backup $latest no figura como verificado en Railway."
cp "$TMP/db/db.dump" "$DEST/db.dump"
cp "$TMP/db/manifest.txt" "$DEST/manifest.txt"
[ "$(sha256_of "$DEST/db.dump")" = "$(grep '^db.dump sha256=' "$DEST/manifest.txt" | cut -d= -f2)" ] \
  || die "El dump descargado no coincide con su sha256."

info "Bajando los PDFs de $PDF_VOLUME..."
# La CLI necesita que la carpeta destino NO exista al bajar la raíz del volumen.
vol "$PDF_VOLUME" download / "$TMP/pdfs" >/dev/null
mkdir -p "$TMP/pdfs"
rm -rf "$TMP/pdfs/lost+found"
tar -czf "$DEST/pdfs.tar.gz" -C "$TMP/pdfs" .
hash_tree "$TMP/pdfs" > "$DEST/pdfs.sha256"
echo "pdfs=$(find "$TMP/pdfs" -type f | wc -l | tr -d ' ')" >> "$DEST/manifest.txt"
echo "pdfs.tar.gz sha256=$(sha256_of "$DEST/pdfs.tar.gz")" >> "$DEST/manifest.txt"
echo "origen=railway backup=$latest" >> "$DEST/manifest.txt"
rm -rf "$TMP"

info "Backup de producción en $DEST"
cat "$DEST/manifest.txt"

if [ "${VERIFY:-1}" = "1" ]; then
  # Railway usa Postgres 18: el simulacro corre en un Postgres 18 temporal en Docker.
  VERIFY_PG_IMAGE="${VERIFY_PG_IMAGE:-postgres:18-alpine}" "$ROOT/scripts/verify-backup.sh" "$DEST"
fi
