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

# A caller-supplied DATABASE_URL wins over the checkout's .env: a reproduction
# must measure the URL it was given, not the one in a developer's working copy.
caller_database_url="${DATABASE_URL:-}"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
if [[ -n "$caller_database_url" ]]; then
  DATABASE_URL="$caller_database_url"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set (export it or provide .env)" >&2
  exit 2
fi

psql_url="${DATABASE_URL%%\?*}"
base_url="${psql_url%/*}"
db_name="${psql_url##*/}"

# Guard: the DATABASE_URL path segment (the database name) is resolved rather
# than the whole URL pattern-matched — the username literally contains
# "lottify_", so matching the full string is unreliable. Whatever the incoming
# name is, this script only ever opens lottify_load_<suffix>: lottify_dev,
# lottify_prod and plain lottify are read for their host only, never opened.
if [[ ! "$db_name" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "cannot resolve a database name from DATABASE_URL (path segment '${db_name}')" >&2
  exit 2
fi
if [[ ! "$suffix" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "refusing to use suffix '$suffix' (expected [A-Za-z0-9_]+)" >&2
  exit 2
fi

load_db="lottify_load_${suffix}"
case "$db_name" in
  lottify_dev|lottify_prod)
    echo "[scratch-db] source database '${db_name}' is never opened; using ${load_db} on the same host" >&2
    ;;
  lottify_load_*)
    load_db="$db_name"
    ;;
  postgres|template0|template1)
    echo "refusing to derive a load database from maintenance database '${db_name}'" >&2
    exit 2
    ;;
esac

# Defence in depth: every path above must end on a dedicated load database name,
# so lottify_dev / lottify_prod can never be the target of a create, migrate or
# drop, whatever the caller passes in.
if [[ "$load_db" != lottify_load_* ]]; then
  echo "refusing to operate on database '$load_db' (expected lottify_load_*)" >&2
  exit 2
fi

load_url="${base_url}/${load_db}"

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
