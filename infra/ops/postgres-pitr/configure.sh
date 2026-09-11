#!/usr/bin/env bash
set -euo pipefail

BASE=${LOTTIFY_BASE:-/home/ubuntu/lottify}
ENV_FILE=${LOTTIFY_DATA_ENV_FILE:-$BASE/runtime/.data.env}
EVIDENCE_DIR=${LOTTIFY_EVIDENCE_DIR:-$BASE/evidence}
CONTAINER=${POSTGRES_CONTAINER:-lottify-production-data-postgres-1}
ARCHIVE_TIMEOUT_SECONDS=${ARCHIVE_TIMEOUT_SECONDS:-300}
WAL_ARCHIVE_DIR=${WAL_ARCHIVE_DIR:-/var/lib/postgresql/pitr-wal}

usage() {
  echo "usage: $0 check|apply|rollback" >&2
}

mode=${1:-}
case "$mode" in
  check|apply|rollback) ;;
  *) usage; exit 64 ;;
esac

if [[ ! "$ARCHIVE_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( ARCHIVE_TIMEOUT_SECONDS < 1 || ARCHIVE_TIMEOUT_SECONDS > 300 )); then
  echo "ARCHIVE_TIMEOUT_SECONDS must be an integer between 1 and 300" >&2
  exit 64
fi

test -r "$ENV_FILE"
# shellcheck disable=SC1090
source "$ENV_FILE"
mkdir -p "$EVIDENCE_DIR"

psql_exec() {
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

setting() {
  psql_exec -Atc "show $1"
}

archive_mode=$(setting archive_mode)
archive_command=$(setting archive_command)
archive_timeout=$(setting archive_timeout)

if [[ "$mode" == check ]]; then
  printf 'archive_mode=%s\narchive_command=%s\narchive_timeout=%s\n' \
    "$archive_mode" "$archive_command" "$archive_timeout"
  [[ "$archive_mode" == on ]]
  [[ -n "$archive_command" ]]
  timeout_seconds=$(psql_exec -Atc "select setting from pg_settings where name='archive_timeout'")
  (( timeout_seconds > 0 && timeout_seconds <= 300 ))
  exit 0
fi

evidence="$EVIDENCE_DIR/postgres-pitr-config-latest.json"

if [[ "$mode" == rollback ]]; then
  test -r "$evidence"
  previous_timeout=$(python3 - "$evidence" <<'PY'
import json,sys
with open(sys.argv[1]) as f:
    print(json.load(f)["previousArchiveTimeout"])
PY
)
  previous_command=$(python3 - "$evidence" <<'PY'
import json,sys
with open(sys.argv[1]) as f:
    print(json.load(f)["previousArchiveCommand"])
PY
)
  psql_exec -c "ALTER SYSTEM SET archive_timeout TO '$previous_timeout'"
  escaped=${previous_command//\'/\'\'}
  psql_exec -c "ALTER SYSTEM SET archive_command TO '$escaped'"
  psql_exec -c 'SELECT pg_reload_conf()'
  printf 'rollback_status=PASS\narchive_timeout=%s\narchive_command=%s\n' \
    "$(setting archive_timeout)" "$(setting archive_command)"
  exit 0
fi

if [[ "$archive_mode" != on ]]; then
  echo "archive_mode must already be on; restart-requiring changes are intentionally out of scope" >&2
  exit 1
fi

docker exec "$CONTAINER" sh -eu -c "mkdir -p '$WAL_ARCHIVE_DIR'; chown postgres:postgres '$WAL_ARCHIVE_DIR'; chmod 700 '$WAL_ARCHIVE_DIR'"

old_archive_dir=$(printf '%s' "$archive_command" | sed -n 's/.*cp %p \([^ ]*\)\/%f.*/\1/p')
if [[ -n "$old_archive_dir" && "$old_archive_dir" != "$WAL_ARCHIVE_DIR" ]]; then
  docker exec "$CONTAINER" sh -eu -c "if [ -d '$old_archive_dir' ]; then cp -pn '$old_archive_dir'/* '$WAL_ARCHIVE_DIR'/ 2>/dev/null || true; fi"
fi

new_archive_command="test ! -f $WAL_ARCHIVE_DIR/%f && cp %p $WAL_ARCHIVE_DIR/%f"
escaped_command=${new_archive_command//\'/\'\'}
psql_exec -c "ALTER SYSTEM SET archive_timeout TO '${ARCHIVE_TIMEOUT_SECONDS}s'"
psql_exec -c "ALTER SYSTEM SET archive_command TO '$escaped_command'"
psql_exec -c 'SELECT pg_reload_conf()'

current_timeout=$(setting archive_timeout)
current_command=$(setting archive_command)
timeout_seconds=$(psql_exec -Atc "select setting from pg_settings where name='archive_timeout'")
[[ "$current_command" == "$new_archive_command" ]]
(( timeout_seconds > 0 && timeout_seconds <= 300 ))

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 - "$evidence" "$now" "$archive_timeout" "$archive_command" "$current_timeout" "$current_command" "$WAL_ARCHIVE_DIR" <<'PY'
import json,sys
path,ts,prev_timeout,prev_command,current_timeout,current_command,archive_dir=sys.argv[1:]
with open(path,"w") as f:
    json.dump({
        "schemaVersion": 1,
        "status": "PASS",
        "appliedAt": ts,
        "previousArchiveTimeout": prev_timeout,
        "previousArchiveCommand": prev_command,
        "archiveTimeout": current_timeout,
        "archiveCommand": current_command,
        "walArchiveDirectory": archive_dir,
        "rollback": "infra/ops/postgres-pitr/configure.sh rollback",
    }, f, indent=2)
    f.write("\n")
PY
chmod 640 "$evidence"

printf 'configure_status=PASS\narchive_timeout=%s\narchive_command=%s\n' "$current_timeout" "$current_command"
