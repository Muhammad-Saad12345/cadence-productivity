#!/usr/bin/env bash
# Browser E2E: builds the app against the local Supabase emulator and drives it in headless Chrome.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export DENO_NO_UPDATE_CHECK=1 NEXT_TELEMETRY_DISABLED=1
"$ROOT/tests/start_pg.sh"
"$ROOT/tests/setup_db.sh" >/dev/null
psql postgres://postgres@127.0.0.1:54322/cadence -qc "update cron.job set active = false" # the test drives dispatch itself
(cd "$HERE" && [[ -d node_modules ]] || npm install --silent)

KEYS=$(cd "$HERE" && node -e 'const w=require("web-push");console.log(JSON.stringify(w.generateVAPIDKeys()))')
export VAPID_PUBLIC_KEY=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).publicKey')
export VAPID_PRIVATE_KEY=$(echo "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).privateKey')
export VAPID_SUBJECT=mailto:e2e@cadence.test
export CRON_SECRET=$(openssl rand -hex 16) NOTIFICATION_ACTION_SECRET=$(openssl rand -hex 16)
export SUPABASE_URL=http://127.0.0.1:54321 PORT=54321

pkill -f supabase-emulator.ts 2>/dev/null || true
(cd "$ROOT" && deno run -A --node-modules-dir=none --config supabase/functions/deno.json tests/e2e/supabase-emulator.ts > /tmp/cadence-emulator.log 2>&1 &)

cd "$ROOT"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=emulator-anon-key NEXT_PUBLIC_VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
npx next build > /tmp/cadence-build.log 2>&1 || { tail -40 /tmp/cadence-build.log; exit 1; }
pkill -f "next start" 2>/dev/null || true
PORT=3000 npx next start -p 3000 > /tmp/cadence-next.log 2>&1 &
export NEXT_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null localhost:3000/login && break; sleep 1; done
node "$HERE/ui.e2e.mjs"
