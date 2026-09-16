#!/usr/bin/env bash
# Boots the candidate API (tsc-compiled, the container shape) against a load database.
#
# It builds with `tsc` and runs the compiled entrypoint on purpose: the `tsx`
# development runner does not emit decorator metadata, so DI is undefined and
# every endpoint 500s (finding W5-F5). A load number produced by a broken DI
# graph would be worthless.
#
# Usage:
#   LOAD_DATABASE_URL=postgresql://... bash tools/load-harness/scripts/boot-api.sh [--port 19199] [--stop]
#
# Writes: <repo>/.hermes/evidence/release/w5-raw-load/api-<port>.log and a pid file.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

port="${API_PORT:-19199}"
mode="start"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --stop) mode="stop"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

evidence_dir="$repo_root/.hermes/evidence/release/w5-raw-load"
mkdir -p "$evidence_dir"
pid_file="$evidence_dir/api-${port}.pid"
log_file="$evidence_dir/api-${port}.log"

if [[ "$mode" == "stop" ]]; then
  if [[ -f "$pid_file" ]]; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
    echo "[boot-api] stopped API on port ${port}"
  else
    echo "[boot-api] no pid file for port ${port}"
  fi
  exit 0
fi

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "[boot-api] API already running on pid $(cat "$pid_file") (log ${log_file})"
  exit 0
fi

# Caller-provided values win over the checkout's .env, matching scratch-db.sh:
# a reproduction run must use the load database and secrets it was given, not a
# developer's local .env.
caller_database_url="${DATABASE_URL:-}"
caller_load_database_url="${LOAD_DATABASE_URL:-}"
caller_jwt_access_secret="${JWT_ACCESS_SECRET:-}"
caller_api_port="${API_PORT:-}"
caller_redis_url="${REDIS_URL:-}"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
[[ -n "$caller_database_url" ]] && DATABASE_URL="$caller_database_url"
[[ -n "$caller_load_database_url" ]] && LOAD_DATABASE_URL="$caller_load_database_url"
[[ -n "$caller_jwt_access_secret" ]] && JWT_ACCESS_SECRET="$caller_jwt_access_secret"
[[ -n "$caller_redis_url" ]] && REDIS_URL="$caller_redis_url"
if [[ -n "$caller_api_port" ]]; then
  port="$caller_api_port"
  pid_file="$evidence_dir/api-${port}.pid"
  log_file="$evidence_dir/api-${port}.log"
fi

if [[ -n "${LOAD_DATABASE_URL:-}" ]]; then
  export DATABASE_URL="$LOAD_DATABASE_URL"
fi
: "${JWT_ACCESS_SECRET:?JWT_ACCESS_SECRET must be set (the code requires it; the shared .env may only carry AUTH_ACCESS_SECRET)}"
export APP_ENV="${APP_ENV:-local}"
export API_PORT="$port"
export OTP_PROVIDER="${OTP_PROVIDER:-console}"

echo "[boot-api] building (tsc -p tsconfig.backend.json)"
pnpm build:backend

echo "[boot-api] starting compiled API on port ${port} (log ${log_file})"
nohup node dist/apps/api/src/main.js >"$log_file" 2>&1 &
echo $! >"$pid_file"

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/internal/health/live" >/dev/null 2>&1; then
    echo "[boot-api] healthy on http://127.0.0.1:${port}"
    exit 0
  fi
  sleep 1
done

echo "[boot-api] API did not become healthy in 60s; tail of ${log_file}:" >&2
tail -30 "$log_file" >&2
exit 1
