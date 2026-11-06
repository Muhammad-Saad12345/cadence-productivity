# Cadence — personal tasks, persistent reminders & goals

Cadence is a full-stack productivity PWA. A task reminds you at its time, then every hour (configurable) until you **complete** or **cancel** it. The reminders are Web Push notifications driven by a server-side scheduler, so they arrive with the tab closed. Cadence also covers weekly and monthly goals, habits, Pomodoro and focus mode, daily and weekly reviews, analytics and achievements.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui-style components (Radix) · Supabase (Postgres, Auth, RLS, Edge Functions, pg_cron, pg_net, Vault) · Web Push (VAPID) · Service Worker · Vercel.

See **ARCHITECTURE.md** for the system design and data model. Test evidence is in **TESTING.md**.

```
src/app/(app)/…            dashboard, today, upcoming, tasks, calendar, goals, projects, habits,
                           focus, review, analytics, notifications, settings
src/app/login, auth/callback, n (token-based notification action screen)
src/components/…           app shell, task editor, quick capture, command palette, UI kit
src/lib/…                  Supabase clients, React Query data layer, timezone utils, quick-add parser, push client
src/proxy.ts               session refresh + auth gate (Next 16 "proxy", formerly middleware)
public/sw.js               service worker: push, notification actions, offline queue, offline page
supabase/migrations/       001 schema · 002 domain logic · 003 scheduler · 004 RLS & RPCs · 005 pg_cron jobs · 006 hardening
supabase/functions/        dispatch-reminders · notification-action · _shared
tests/                     DB/scheduler tests, Edge Function E2E push tests, browser E2E tests
```

---

## 1. Local development

Prerequisites: Node 20+, the Supabase CLI (`npm i -g supabase`), and Docker (the Supabase CLI uses it for the local stack).

```bash
npm install
supabase start                       # local Postgres/Auth/Functions; prints URL + anon key
supabase db reset                    # applies supabase/migrations/*
npx web-push generate-vapid-keys     # once; keep the private key secret
cp .env.example .env.local           # fill NEXT_PUBLIC_* from `supabase status` + VAPID public key
cp supabase/.env.example supabase/.env   # fill VAPID keys, CRON_SECRET, NOTIFICATION_ACTION_SECRET
supabase functions serve --env-file supabase/.env
npm run dev                          # http://localhost:3000 (localhost counts as a secure context for push)
```

In local development pg_cron runs `run_scheduler_tick()` every minute. To deliver pushes locally, either store the Vault secrets as described in §2.4, using `http://host.docker.internal:54321` as the project URL, or call the dispatcher by hand:

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/dispatch-reminders -H "Authorization: Bearer $CRON_SECRET"
```

## 2. Deployment (Supabase + Vercel + GitHub)

### 2.1 Supabase project
1. Create a project and choose a region close to you (for example `ap-south-1`).
2. Link it and push the schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push              # runs all 6 migrations (enables pg_cron + pg_net, schedules jobs)
   ```
3. **Auth → URL configuration:** set the Site URL to `https://<your-app>.vercel.app` and add `https://<your-app>.vercel.app/auth/callback` to the redirect URLs.

### 2.2 Secrets (Supabase Vault — recommended)
The Edge Functions read each secret from an Edge Function secret (env var) if one is set; otherwise they read it from **Supabase Vault**. With Vault, the random secrets are generated inside the database and never leave it in plain text. Run this once in the SQL editor:
```sql
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cadence_cron_secret');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cadence_action_secret');
select vault.create_secret('https://<ref>.supabase.co', 'cadence_project_url');
select vault.create_secret('mailto:you@example.com', 'cadence_vapid_subject');
select vault.create_secret('<VAPID public key>',  'cadence_vapid_public_key');
select vault.create_secret('<VAPID private key>', 'cadence_vapid_private_key');   -- from: npx web-push generate-vapid-keys
```
(Alternatively use `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=… CRON_SECRET=… NOTIFICATION_ACTION_SECRET=…`. If you do, `CRON_SECRET` must equal the Vault value `cadence_cron_secret`, which pg_cron sends.)

### 2.3 Edge Functions
```bash
supabase functions deploy dispatch-reminders --no-verify-jwt
supabase functions deploy notification-action --no-verify-jwt
supabase secrets set ALLOWED_ORIGINS=https://<your-app>.vercel.app   # optional CORS restriction
```
`--no-verify-jwt` is required: both functions authenticate requests themselves.
- **dispatch-reminders** checks the cron bearer secret.
- **notification-action** checks an HMAC-signed, per-notification token. The service worker has no user session when the tab is closed, so it can't send a user JWT.

`SUPABASE_URL` and `SUPABASE_DB_URL` are injected automatically.

### 2.4 Vercel (frontend)
1. Push the repo to GitHub, then import it in Vercel (framework: Next.js).
2. Set the environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
3. Deploy. Vercel serves HTTPS, which Web Push requires.

### 2.5 Turn on the scheduler
The pg_cron jobs from migration 005 start working once `cadence_project_url` and `cadence_cron_secret` exist in Vault (§2.2). Verify:
```sql
select jobname, schedule, active from cron.job;                       -- 3 cadence-* jobs
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
```
Until both secrets exist, the dispatch job does nothing. The SQL tick still enqueues reminders, and they still appear in the in-app Notification Center.

### 2.6 Smoke test after deploying
Sign up, then go to **Settings → This device → Enable**, then **Send test**. A push should arrive within about a minute. Next, create a task with quick add, e.g. "Test in 2m", close the tab, and wait for the reminder.

## 3. Environment variables checklist

| Variable | Where | Secret? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | no | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | no | anon/publishable key; RLS protects data |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel | no | Must equal `VAPID_PUBLIC_KEY` |
| Vault `cadence_vapid_public_key` / `cadence_vapid_private_key` | Supabase Vault (or function secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) | **private key: yes** | `npx web-push generate-vapid-keys` |
| Vault `cadence_vapid_subject` | Supabase Vault (or `VAPID_SUBJECT`) | no | `mailto:you@example.com` |
| Vault `cadence_cron_secret` | Supabase Vault (or `CRON_SECRET`; must match) | **yes** | Generated in SQL; sent by pg_cron, checked by dispatch-reminders |
| Vault `cadence_action_secret` | Supabase Vault (or `NOTIFICATION_ACTION_SECRET`) | **yes** | Signs notification action tokens; rotating it invalidates open reminders |
| `ALLOWED_ORIGINS` | Supabase function secrets (optional) | no | Your app origin(s), comma-separated; defaults to `*` (tokens, not cookies, authorise requests) |
| Vault `cadence_project_url` | Supabase Vault | no | `https://<ref>.supabase.co` |

The service-role key is **not used anywhere**. The Edge Functions use the injected `SUPABASE_DB_URL`. Nothing secret is prefixed `NEXT_PUBLIC_`.

## 4. How reminders work (short version)
- When you create a task, the database sets `next_reminder_at` to the task's start time, or to its deadline if it has no start time.
- Every minute, pg_cron runs `run_scheduler_tick()`. It locks due tasks with `SKIP LOCKED`, writes one notification per slot (the unique `dedupe_key` blocks duplicates), and moves `next_reminder_at` forward by your interval.
- The `dispatch-reminders` function leases queued notifications and sends Web Push to every device. It retries 429/5xx responses with backoff and disables 404/410 subscriptions. Every attempt is logged.
- **Complete / Cancel** set the task's status. A database `CHECK` constraint plus a trigger guarantee that a closed task can never be reminded again. **Pending** keeps the hourly cycle going. **Snooze** offers 1 h, 3 h, or until tomorrow morning.
- Quiet hours postpone reminders rather than dropping them. Once the daily limit is reached, further reminders roll over to the next morning.

## 5. Running the tests
```bash
# Backend: real Postgres 16 + pg_cron, Deno (no Docker needed)
sudo apt-get install postgresql-16 postgresql-16-cron     # once
npm i -g deno                                             # once
tests/run.sh                    # DB/scheduler/RLS suite + Edge Function E2E with a mock HTTPS push service
npx vitest run                  # timezone + quick-add parser unit tests
tests/e2e/run.sh                # builds the app and drives it in headless Chrome (needs google-chrome)
npm run lint && npx tsc --noEmit && npx next build
```

## 6. Browser notification support (honest limitations)

| Platform | Background push | Action buttons | Notes |
|---|---|---|---|
| Chrome / Edge (Windows, Linux, ChromeOS) | ✅ | **2** buttons | Cadence shows **Complete** + **More options…**; the latter, or a click on the body, opens the action screen with Pending / Cancel / Snooze. The browser process must be running (Chrome's "Continue running background apps" setting). |
| Chrome (macOS) | ✅ | 2, under the notification's "Options" menu | macOS must allow notifications for Chrome (System Settings → Notifications). |
| Chrome (Android) | ✅ | up to 3 | Works with the app closed; battery optimisation can delay delivery. |
| Firefox (desktop/Android) | ✅ | **none** | Clicking the notification opens the action screen. Firefox must be running. |
| Safari (macOS 13+) | ✅ | none | Click → action screen. |
| Safari (iOS/iPadOS 16.4+) | ✅ **only after "Add to Home Screen"** | none | Push works only in the installed PWA, not in a Safari tab. The app explains this. |
| Any browser, notifications blocked / unsupported | ❌ | — | Reminders still appear in the in-app Notification Center and as toasts while the app is open. |

Other limits to know:
- **Delivery depends on the browser vendor's push service** (FCM, Mozilla, Apple) and on connectivity. A powered-off or offline device receives the latest reminder when it reconnects. A push `Topic` per task means stale reminders are replaced rather than piled up.
- **Timing:** pg_cron runs every minute, so reminders fire within about 0–60 s of their scheduled time. Push services can add their own delay.
- **Restarting the device:** the schedule lives on the server, so nothing is lost. Desktop browsers have to be running, and most start background processes at login.
- If a push service rotates a subscription (`pushsubscriptionchange`), the service worker re-subscribes, and the new endpoint is registered the next time you open the app.
- Pressing a notification button while offline queues the action in IndexedDB. It is replayed by Background Sync (Chromium), on the next push, or the next time the app opens.

## 7. Not implemented yet / manual configuration
- **Google Calendar sync** (Phase 3): not implemented. It needs a Google Cloud OAuth client and verification. A placeholder appears in Settings.
- **AI-assisted daily planning** (Phase 3): not implemented.
- **Emails** (sign-up confirmation, magic links) use Supabase's built-in mailer, which is rate-limited. Configure a custom SMTP server in Supabase for production.
- **Drag-and-drop** on the calendar is mouse/desktop only. On touch devices, open the task and change its date.
- **Monthly recurrence** from the 29th–31st clamps to the end of shorter months. The next occurrence is then computed from that clamped date.
