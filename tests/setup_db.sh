#!/usr/bin/env bash
# Recreates the local test database: Supabase shim + all migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL=${PGURL:-postgres://postgres@127.0.0.1:54322}
DB=${DB:-cadence}
psql "$PGURL/postgres" -qX -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
psql "$PGURL/$DB" -qX -v ON_ERROR_STOP=1 -f tests/sql/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do
  if [[ "$f" == *cron_jobs.sql ]]; then
    # pg_net is not available locally; the shim provides net.http_post.
    sed '/create extension if not exists pg_net/d' "$f" | psql "$PGURL/$DB" -qX -v ON_ERROR_STOP=1 -f - >/dev/null
  else
    psql "$PGURL/$DB" -qX -v ON_ERROR_STOP=1 -f "$f"
  fi
  echo "applied $(basename "$f")"
done
