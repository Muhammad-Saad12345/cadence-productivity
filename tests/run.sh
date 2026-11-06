#!/usr/bin/env bash
# Runs the backend test suites against a local Postgres 16 + pg_cron (see tests/README.md).
#   tests/run.sh            → DB/scheduler tests + Edge Function E2E tests
set -euo pipefail
cd "$(dirname "$0")"
export DENO_NO_UPDATE_CHECK=1
# A throwaway CA signs the mock push service's TLS certificate (push endpoints must be https).
if [[ ! -f /tmp/mockpush.crt || ! -f /tmp/testca.crt ]]; then
  (cd /tmp
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout testca.key -out testca.crt \
     -days 30 -subj "/CN=Cadence Test CA" -addext "basicConstraints=critical,CA:TRUE" \
     -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
   openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout mockpush.key -out mockpush.csr \
     -subj "/CN=localhost" 2>/dev/null
   printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n" > ext.cnf
   openssl x509 -req -in mockpush.csr -CA testca.crt -CAkey testca.key -CAcreateserial -out mockpush.crt \
     -days 30 -extfile ext.cnf 2>/dev/null)
fi
# Trust the test CA in addition to whatever CA bundle the environment already uses.
cat ${DENO_CERT:-} /tmp/testca.crt > /tmp/cadence-test-ca.pem 2>/dev/null || cp /tmp/testca.crt /tmp/cadence-test-ca.pem
export DENO_CERT=/tmp/cadence-test-ca.pem
export NODE_EXTRA_CA_CERTS=/tmp/cadence-test-ca.pem
./start_pg.sh
./setup_db.sh
echo "── DB / scheduler / RLS tests ──"
deno test -A --no-check --node-modules-dir=none db/scheduler.test.ts
./setup_db.sh >/dev/null
echo "── Edge Function E2E push tests ──"
deno test -A --no-check --node-modules-dir=none --config ../supabase/functions/deno.json functions/push_e2e.test.ts 2>&1 | grep -v '"level":"info"'
