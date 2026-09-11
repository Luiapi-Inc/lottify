#!/usr/bin/env bash
set -euo pipefail

BASE=${LOTTIFY_BASE:-/home/ubuntu/lottify}
ENV_FILE=${LOTTIFY_DATA_ENV_FILE:-$BASE/runtime/.data.env}
EVIDENCE_DIR=${LOTTIFY_EVIDENCE_DIR:-$BASE/evidence}
CONTAINER=${POSTGRES_CONTAINER:-lottify-production-data-postgres-1}
POSTGRES_IMAGE=${POSTGRES_PITR_IMAGE:-postgres:18-alpine}
WAL_ARCHIVE_DIR=${WAL_ARCHIVE_DIR:-/var/lib/postgresql/pitr-wal}
WAL_ARCHIVE_HOST_DIR=${WAL_ARCHIVE_HOST_DIR:-$BASE/data/postgres/pitr-wal}
INTEGRITY_SQL=${PITR_INTEGRITY_SQL:-$(cd "$(dirname "$0")" && pwd)/integrity.sql}
TMP_PARENT=${PITR_TMP_PARENT:-/dev/shm}
BACKUP=${1:-}

if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "usage: $0 /path/to/lottify-base-*.tar.gz" >&2
  exit 64
fi
test -r "$ENV_FILE"
test -r "$INTEGRITY_SQL"
test -d "$WAL_ARCHIVE_HOST_DIR"
# shellcheck disable=SC1090
source "$ENV_FILE"
mkdir -p "$EVIDENCE_DIR"

ts=$(date -u +%Y%m%dT%H%M%SZ)
target="lottify_pitr_verify_$ts"
restore_container="lottify-pitr-verify-$$"
tmp_root=$(mktemp -d "$TMP_PARENT/lottify-pitr-verify.XXXXXX")
restore_root="$tmp_root/postgresql"
pgdata="$restore_root/18/docker"
started_epoch=$(date +%s)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cleanup() {
  docker rm -f "$restore_container" >/dev/null 2>&1 || true
  if [[ -d "$tmp_root/postgresql" ]]; then
    docker run --rm -v "$tmp_root:/cleanup" "$POSTGRES_IMAGE" \
      sh -eu -c 'rm -rf /cleanup/postgresql' >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_root" >/dev/null 2>&1 || true
}
trap cleanup EXIT

prod_psql() {
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

archive_timeout_seconds=$(prod_psql -Atc "select setting from pg_settings where name='archive_timeout'")
if (( archive_timeout_seconds < 1 || archive_timeout_seconds > 300 )); then
  echo "archive_timeout must be between 1 and 300 seconds before PITR verification" >&2
  exit 1
fi

backup_sha=$(sha256sum "$BACKUP" | awk '{print $1}')
mkdir -p "$pgdata"
tar -xzf "$BACKUP" -C "$pgdata"
test -f "$pgdata/backup_label"

target_lsn=$(prod_psql -Atc "select pg_create_restore_point('$target')")
target_wal=$(prod_psql -Atc "select pg_walfile_name('$target_lsn'::pg_lsn)")
target_epoch=$(date +%s)
prod_psql -Atc 'select pg_switch_wal()' >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" test -f "$WAL_ARCHIVE_DIR/$target_wal"; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" test -f "$WAL_ARCHIVE_DIR/$target_wal"
docker run --rm -v "$WAL_ARCHIVE_HOST_DIR:/pitr-archive:ro" "$POSTGRES_IMAGE" \
  test -f "/pitr-archive/$target_wal"
archived_epoch=$(date +%s)
rpo_seconds=$((archived_epoch - target_epoch))
(( rpo_seconds <= 300 ))

cat >> "$pgdata/postgresql.auto.conf" <<EOF
restore_command = 'cp /pitr-archive/%f %p'
recovery_target_name = '$target'
recovery_target_action = 'promote'
archive_command = '/bin/true'
EOF
touch "$pgdata/recovery.signal"

docker run --rm \
  -v "$restore_root:/var/lib/postgresql" \
  "$POSTGRES_IMAGE" \
  sh -eu -c 'chown -R postgres:postgres /var/lib/postgresql/18/docker'

docker run -d --name "$restore_container" --network none \
  -v "$restore_root:/var/lib/postgresql" \
  -v "$WAL_ARCHIVE_HOST_DIR:/pitr-archive:ro" \
  "$POSTGRES_IMAGE" >/dev/null

for _ in $(seq 1 120); do
  if docker exec "$restore_container" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$restore_container" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

in_recovery=$(docker exec "$restore_container" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'select pg_is_in_recovery()')
[[ "$in_recovery" == f ]]

integrity_output=$(docker exec -i "$restore_container" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$INTEGRITY_SQL")
grep -q 'integrity_status=PASS' <<<"$integrity_output"

completed_epoch=$(date +%s)
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rto_seconds=$((completed_epoch - started_epoch))
(( rto_seconds <= 3600 ))

evidence="$EVIDENCE_DIR/postgres-pitr-restore-latest.json"
python3 - "$evidence" "$started_at" "$completed_at" "$BACKUP" "$backup_sha" "$target" "$target_lsn" "$target_wal" "$rpo_seconds" "$rto_seconds" <<'PY'
import json,sys
(path,started,completed,backup,sha,target,target_lsn,target_wal,rpo,rto)=sys.argv[1:]
with open(path,"w") as f:
    json.dump({
        "schemaVersion": 1,
        "status": "PASS",
        "startedAt": started,
        "completedAt": completed,
        "baseBackupPath": backup,
        "baseBackupSha256": sha,
        "recoveryTargetName": target,
        "recoveryTargetLsn": target_lsn,
        "recoveryTargetWal": target_wal,
        "rpoSeconds": int(rpo),
        "rtoSeconds": int(rto),
        "integrity": "PASS",
        "productionBusinessRowsMutatedForTest": False,
    }, f, indent=2)
    f.write("\n")
PY
chmod 640 "$evidence"

printf 'pitr_restore_status=PASS\ntarget=%s\ntarget_wal=%s\nrpo_seconds=%s\nrto_seconds=%s\nintegrity_status=PASS\n' \
  "$target" "$target_wal" "$rpo_seconds" "$rto_seconds"
