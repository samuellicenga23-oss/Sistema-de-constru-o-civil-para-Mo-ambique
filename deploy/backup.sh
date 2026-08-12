#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

for command in pg_dump pg_restore git node base64 sha256sum find; do require_command "$command"; done
if [[ "${1:-}" == "--with-uploads" ]]; then require_command tar; fi
load_postgres_client_environment

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release="$(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
database_backup="$BACKUP_DIR/sigo-${timestamp}-${release}.dump"

log "A criar backup PostgreSQL…"
umask 077
pg_dump --format=custom --no-owner --no-acl --file="$database_backup"
pg_restore --list "$database_backup" >/dev/null
sha256sum "$database_backup" >"${database_backup}.sha256"
log "Backup validado: $database_backup"

if [[ "${1:-}" == "--with-uploads" ]]; then
  uploads_dir="${UPLOADS_DIR:-./uploads}"
  [[ "$uploads_dir" = /* ]] || uploads_dir="$PROJECT_DIR/apps/api/$uploads_dir"
  if [[ -d "$uploads_dir" ]]; then
    uploads_backup="$BACKUP_DIR/sigo-uploads-${timestamp}-${release}.tar.gz"
    tar --create --gzip --file="$uploads_backup" --directory="$(dirname "$uploads_dir")" "$(basename "$uploads_dir")"
    sha256sum "$uploads_backup" >"${uploads_backup}.sha256"
    log "Uploads guardados: $uploads_backup"
  else
    log "Uploads não encontrados; backup limitado à base de dados."
  fi
fi

# Retenção conservadora: apagar apenas backups SIGO com mais de 30 dias.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'sigo-*' -mtime +30 -delete
