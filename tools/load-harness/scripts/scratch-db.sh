#!/usr/bin/env bash
# Creates a dedicated load database and applies the candidate's migrations to it.
#
# The build must not be run against a shared database: seeding writes Member,
# Ledger and Betting rows and settlement/financial assertions count them. The
# name is always lottify_load_<suffix>, and --drop removes exactly that name.
#
# Usage:
#   bash tools/load-harness/scripts/scratch-db.sh --suffix t4fd8e4a7 [--drop]
#   (prints the DATABASE_URL to export; never touches lottify_dev/lottify_prod)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

suffix="${LOAD_DB_SUFFIX:-t4fd8e4a7}"
drop=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --suffix) suffix="$2"; shift 2 ;;
    --drop) drop=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set (export it or provide .env)" >&2
  exit 2
fi

psql_url="${DATABASE_URL%%\?*}"
# Guard: never let this script resolve to the application database. Only the
# trailing path segment (the database name) is rewritten — rewriting the whole
# string would also hit the username, which literally contains "lottify_".
case "$psql_url" in
  *lottify_dev*|*lottify_prod*|*lottify_load_*)
    load_url="${psql_url%/*}/lottify_load_${suffix}"
    ;;
  *)
    load_url="${psql_url}"
    ;;
esac

load_db="$(echo "$load_url" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
if [[ "$load_db" != lottify_load_* ]]; then
  echo "refusing to operate on database '$load_db' (expected lottify_load_*)" >&2
  exit 2
fi

if [[ "$drop" == "1" ]]; then
  psql "${load_url%/*}/postgres" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${load_db}\";"
  echo "[scratch-db] dropped ${load_db}"
  exit 0
fi

if psql "${load_url%/*}/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='${load_db}'" | grep -q 1; then
  echo "[scratch-db] ${load_db} already exists (reusing)"
else
  psql "${load_url%/*}/postgres" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${load_db}\";"
  echo "[scratch-db] created ${load_db}"
fi

DATABASE_URL="$load_url" node_modules/.bin/prisma migrate deploy
echo "[scratch-db] migrations applied"

# Only the scratch database: DATABASE_URL with the ?schema= query stripped for callers.
echo "LOAD_DATABASE_URL=${load_url}"
