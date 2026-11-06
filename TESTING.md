# Test results

Run on 6 Nov 2026 in a Linux sandbox with PostgreSQL 16, pg_cron 1.6, Deno 2.9, Node 22, headless Chrome 153 and Next.js 16.4.5.
The commands are listed in the README, §5.

| Suite | Result |
|---|---|
| `tests/run.sh` → DB, scheduler and RLS tests (real Postgres + pg_cron, pinned clock) | **12/12 steps + pg_cron run ✔** |
| `tests/run.sh` → Edge Function E2E (real handlers, HTTPS mock push service that **decrypts** payloads per RFC 8291 and **verifies** VAPID JWTs per RFC 8292) | **11/11 ✔** |
| `tests/e2e/run.sh` → browser E2E (built app + service worker in headless Chrome) | **23/23 ✔, 0 page errors** |
| `npx vitest run` → timezone helpers + quick-add parser | **6/6 ✔** |
| `tsc --noEmit`, `deno check`, `next build` | ✔ |
| `eslint` | 0 errors (11 warnings from the `set-state-in-effect` advisory, intentionally downgraded) |

## The 10 required scenarios

| # | Scenario | Verified by | How |
|---|---|---|---|
| 1 | Create a task with a future timestamp | DB S1, browser "quick add", Edge S1 | Task is `upcoming`, `next_reminder_at` equals the task time; the quick-add text "tomorrow 5pm" resolves to 17:00 Asia/Karachi |
| 2 | First reminder at the correct time | DB S1 (pinned clock), Edge S1 (wall clock), browser S1 | Nothing fires at T−1 min; one reminder at T. The real push reached the mock push service within seconds of T, with TTL, `Urgency: high`, `Topic` and a valid VAPID signature |
| 3 | Another reminder after 60 min if incomplete | DB S1 (pinned clock: none at +30 min, one at +60 min, a single catch-up after a 2.5 h outage with the hourly phase kept), Edge S3 | "Reminder 2" appears in the decrypted payload |
| 4 | Complete from the notification stops reminders | Edge S4, browser S4 (the service worker's `notificationclick` handler with **no app page open**), DB S1 | Status `completed`, `completed_at` saved, history `source=notification`; no reminders in later ticks; the DB CHECK constraint rejects re-arming even with the trigger disabled |
| 5 | Pending continues the cycle | DB S5, Edge S5, browser S5 | Status `pending`; next reminder at +60 min, which then arrives |
| 6 | Cancel stops reminders | DB S6, Edge S6, browser S6 | Status `cancelled`, reminder cleared, row and history kept; a later Pending on the closed task returns 409 |
| 7 | Notification with the website tab closed | browser S7/S4 | A push delivered through Chrome's push pipeline (`ServiceWorker.deliverPushMessage`) is shown by the service worker with action buttons, and the action completes the task with only `about:blank` open. **Delivery through the real FCM/Mozilla/Apple push services could not be exercised here (no outbound access); see "Not verifiable here".** |
| 8 | Completing a weekly/monthly goal updates progress | DB S8, Edge S8, browser S8 | Progress modes tasks/milestones/target/children; monthly rolls up weekly goals; completion writes an achievement and the `first_goal` badge, queues an achievement push, and the celebration dialog appears once |
| 9 | Denied permission and offline | browser: "denied" card, in-app toast fallback (Complete from the toast), offline banner, SW offline page, offline action queue → synced on reconnect; Edge: `no_channel` row still in the inbox | — |
| 10 | No duplicates when jobs run repeatedly | DB S10: 6 concurrent workers × 2 ticks → exactly one reminder per task, no notification leased twice; Edge: 4 concurrent dispatcher calls → 1 push | — |

Other things the tests cover:
- Retry with backoff on 503, then delivered.
- A 410 Gone subscription is disabled while other devices keep receiving.
- 5-attempt cap.
- Quiet hours postpone reminders rather than dropping them.
- Daily limit rolls reminders over to the next morning.
- Recurrence: daily, weekdays (Fri→Mon), weekly on chosen days, monthly with end-of-month clamp, ending a series; spawning is idempotent.
- Each digest is sent exactly once: morning, evening, goal check-in, weekly review, deadline warning, habit nudge.
- RLS: user B can't read, update, delete or link to A's rows; clients can't write server-owned columns or call scheduler functions; anon has no access.
- Push subscription reassignment between accounts.
- Action token tampering returns 401.
- Calendar drag-and-drop moves a task by one day and keeps its time.
- Habits, Pomodoro and settings persistence.

## How the browser tests reach a backend (read this)
Docker isn't available here, so the Supabase CLI stack couldn't run. `tests/e2e/supabase-emulator.ts` is a **test-only** stand-in for the Supabase HTTP API: GoTrue sign-up and password login, plus the PostgREST subset this app uses. It runs every request against the **same real Postgres** as the `authenticated` role with JWT claims set, so **RLS is enforced the way PostgREST enforces it**. `/functions/v1/*` are served by the **real** Edge Function handlers.

It is not PostgREST. Realtime isn't emulated, which is why the browser test exercises the in-app **polling** fallback (up to 60 s) and not live updates. Run the app once against a real Supabase project before relying on it.

## Not verifiable here (needs your real deployment)
1. **Delivery through the browser vendors' push services** (FCM, Mozilla autopush, Apple). The sandbox blocks those hosts. The encryption and VAPID signing are verified byte-for-byte against the RFCs. Real delivery is checked with Settings → **Send test**.
2. **The pg_net → Edge Function HTTP call on Supabase.** Locally, pg_net was replaced by a stub that records the exact URL and `Authorization` header; the real pg_cron worker did run the SQL tick.
3. **Supabase Realtime** live updates. Polling every 60 s is the tested fallback.
4. **iOS, Android and Firefox notification UI.** The behaviour is designed per the platform limits in the README §6; only Chrome desktop was automated.
5. **Email confirmation and magic links.** Sign-up was tested with auto-confirm.

Screenshots from the browser run are in `docs/screenshots/`.
