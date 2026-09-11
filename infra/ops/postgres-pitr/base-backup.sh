#!/usr/bin/env bash
set -euo pipefail

BASE=${LOTTIFY_BASE:-/home/ubuntu/lottify}
ENV_FILE=${LOTTIFY_DATA_ENV_FILE:-$BASE/runtime/.data.env}
BACKUP_DIR=${PITR_BASE_BACKUP_DIR:-$BASE/backups/postgres-base}
EVIDENCE_DIR=${LOTTIFY_EVIDENCE_DIR:-$BASE/evidence}
CONTAINER=${POSTGRES_CONTAINER:-lottify-production-data-postgres-1}
RETENTION_DAYS=${PITR_BASE_BACKUP_RETENTION_DAYS:-7}

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo "PITR_BASE_BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 64
fi

test -r "$ENV_FILE"
# shellcheck disable=SC1090
source "$ENV_FILE"
mkdir -p "$BACKUP_DIR" "$EVIDENCE_DIR"

ts=$(date -u +%Y%m%dT%H%M%SZ)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
remote_dir="/tmp/lottify-pitr-base-$ts"
out="$BACKUP_DIR/lottify-base-$ts.tar.gz"
tmp="$out.tmp"

cleanup() {
  rm -f "$tmp"
  docker exec "$CONTAINER" rm -rf "$remote_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
docker exec "$CONTAINER" sh -eu -c "rm -rf '$remote_dir'; mkdir -p '$remote_dir'; chown postgres:postgres '$remote_dir'"
docker exec -u postgres "$CONTAINER" \
  pg_basebackup -U "$POSTGRES_USER" -D "$remote_dir" -Fp -Xs -c fast --no-password

read -r start_lsn end_lsn < <(
  docker exec "$CONTAINER" cat "$remote_dir/backup_manifest" | python3 -c '
import json,sys
manifest=json.load(sys.stdin)
ranges=manifest.get("WAL-Ranges", [])
if not ranges:
    raise SystemExit("backup manifest has no WAL-Ranges")
print(ranges[0]["Start-LSN"], ranges[-1]["End-LSN"])
'
)
start_wal=$(docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_walfile_name('$start_lsn'::pg_lsn)")
stop_wal=$(docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_walfile_name('$end_lsn'::pg_lsn)")
test -n "$start_wal"
test -n "$stop_wal"

docker exec "$CONTAINER" tar -C "$remote_dir" -czf - . > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$out"

sha=$(sha256sum "$out" | awk '{print $1}')
bytes=$(wc -c < "$out" | tr -d ' ')
server_version=$(docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'show server_version')
archive_timeout=$(docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'show archive_timeout')
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

find "$BACKUP_DIR" -type f -name 'lottify-base-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete
evidence="$EVIDENCE_DIR/postgres-pitr-base-backup-latest.json"
python3 - "$evidence" "$started_at" "$completed_at" "$out" "$sha" "$bytes" "$RETENTION_DAYS" "$server_version" "$archive_timeout" "$start_lsn" "$end_lsn" "$start_wal" "$stop_wal" <<'PY'
import json,sys
(path,started,completed,backup,sha,size,retention,version,archive_timeout,start_lsn,end_lsn,start_wal,stop_wal)=sys.argv[1:]
with open(path,"w") as f:
    json.dump({
        "schemaVersion": 1,
        "status": "PASS",
        "startedAt": started,
        "completedAt": completed,
        "backupPath": backup,
        "sha256": sha,
        "bytes": int(size),
        "retentionDays": int(retention),
        "postgresVersion": version,
        "archiveTimeout": archive_timeout,
        "startLsn": start_lsn,
        "endLsn": end_lsn,
        "startWalFile": start_wal,
        "stopWalFile": stop_wal,
    }, f, indent=2)
    f.write("\n")
PY
chmod 640 "$evidence"

printf 'base_backup_status=PASS\nbackup=%s\nsha256=%s\nbytes=%s\nstart_wal=%s\nstop_wal=%s\n' \
  "$out" "$sha" "$bytes" "$start_wal" "$stop_wal"
