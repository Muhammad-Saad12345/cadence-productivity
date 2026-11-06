#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL 16 + pg_cron on :54322 for the test suites.
# (Ubuntu/Debian: apt-get install postgresql-16 postgresql-16-cron)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${PGDATA_DIR:-/tmp/pgdata}
if [[ ! -f "$DATA/PG_VERSION" ]]; then
  mkdir -p "$DATA" && chown postgres:postgres "$DATA"
  su postgres -c "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
  cat >> "$DATA/postgresql.conf" <<CONF
shared_preload_libraries = 'pg_cron'
cron.database_name = 'cadence'
timezone = 'UTC'
CONF
fi
if ! su postgres -c "$PGBIN/pg_ctl -D $DATA status" >/dev/null 2>&1; then
  su postgres -c "$PGBIN/pg_ctl -D $DATA -l /tmp/pg.log -o '-p 54322 -c listen_addresses=127.0.0.1' start" >/dev/null
  sleep 2
fi
echo "postgres running on 127.0.0.1:54322"
