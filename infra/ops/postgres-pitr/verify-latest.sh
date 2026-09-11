#!/usr/bin/env bash
set -euo pipefail

BASE=${LOTTIFY_BASE:-/home/ubuntu/lottify}
BACKUP_DIR=${PITR_BASE_BACKUP_DIR:-$BASE/backups/postgres-base}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

backup=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lottify-base-*.tar.gz' -printf '%T@ %p\n' \
  | sort -nr \
  | head -n1 \
  | cut -d' ' -f2-)

if [[ -z "$backup" ]]; then
  echo "no physical PITR base backup found in $BACKUP_DIR" >&2
  exit 1
fi

exec "$SCRIPT_DIR/verify-restore.sh" "$backup"
