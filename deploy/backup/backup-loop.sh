#!/bin/sh
# Backups periódicos de la base: /backups/<fecha-hora>/{db.dump,manifest.txt}.
# Después de cada backup hace un simulacro de restauración en una base temporal del mismo
# servidor y compara los datos: así cada backup queda probado, sin tocar la base real.
# Variables: DATABASE_URL (obligatoria), BACKUP_DIR=/backups, KEEP=14, INTERVAL_SECONDS=86400.
set -eu
DIR="${BACKUP_DIR:-/backups}"
KEEP="${KEEP:-14}"
INTERVAL="${INTERVAL_SECONDS:-86400}"
: "${DATABASE_URL:?Falta DATABASE_URL}"
URL="${DATABASE_URL%%\?*}"
SCRATCH_DB="restore_check"
SCRATCH_URL="${URL%/*}/$SCRATCH_DB"

fingerprint() {
  psql "$1" -At -v ON_ERROR_STOP=1 -c "
    select 'users=' || count(*) from \"User\";
    select 'invoices=' || count(*) || ' total=' || coalesce(sum(\"totalAmount\"), 0) || ' kg=' || coalesce(sum(\"slaughterKg\"), 0) from \"Invoice\";
    select 'paid=' || count(*) from \"Invoice\" where status = 'PAID';
    select 'status_logs=' || count(*) from \"InvoiceStatusLog\";
    select 'migrations=' || count(*) from \"_prisma_migrations\";"
}

verify_backup() {
  dest="$1"
  psql "$URL" -q -c "drop database if exists $SCRATCH_DB" -c "create database $SCRATCH_DB"
  if ! pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$dest/db.dump"; then
    psql "$URL" -q -c "drop database if exists $SCRATCH_DB"
    echo "verificado=FALLÓ (pg_restore)" >> "$dest/manifest.txt"
    echo "Restauración FALLÓ: pg_restore devolvió error"
    return 1
  fi
  expected="$(grep -E '^(users|invoices|paid|status_logs|migrations)=' "$dest/manifest.txt")"
  actual="$(fingerprint "$SCRATCH_URL")"
  psql "$URL" -q -c "drop database if exists $SCRATCH_DB"
  if [ "$expected" = "$actual" ]; then
    echo "verificado=ok" >> "$dest/manifest.txt"
    echo "Restauración verificada OK: $(echo "$actual" | tr '\n' ' ')"
  else
    echo "verificado=FALLÓ" >> "$dest/manifest.txt"
    echo "Restauración NO coincide. Esperado: $expected / Restaurado: $actual"
    return 1
  fi
}

run_backup() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  dest="$DIR/$stamp"
  mkdir -p "$dest"
  pg_dump "$URL" --format=custom --no-owner --no-privileges -f "$dest/db.dump"
  {
    echo "fecha=$stamp"
    fingerprint "$URL"
    echo "db.dump sha256=$(sha256sum "$dest/db.dump" | cut -d' ' -f1)"
  } > "$dest/manifest.txt"
  echo "Backup OK $stamp ($(du -h "$dest/db.dump" | cut -f1))"
  verify_backup "$dest"
  # Conservar solo los últimos KEEP backups.
  ls -1d "$DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
}

while true; do
  run_backup || echo "Backup FALLÓ $(date -u +%Y%m%d-%H%M%S)"
  sleep "$INTERVAL"
done
