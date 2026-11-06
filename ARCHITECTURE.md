# Cadence — Technical Architecture

Cadence is a personal task, reminder, goal and habit manager. It runs as a Next.js PWA on Vercel, with Supabase handling auth, Postgres, Edge Functions and pg_cron.
The reminder pipeline is the core of the product. Every other part of the design is kept simple so the reminders stay reliable.

## 1. System overview

```
 Browser / installed PWA                      Supabase
 ┌──────────────────────────┐   supabase-js   ┌──────────────────────────────────────┐
 │ Next.js App Router (UI)  │ ───(RLS)──────▶ │ Postgres                              │
 │ React Query cache        │ ◀── realtime ── │  tasks, goals, habits, notifications │
 │ Service Worker (sw.js)   │                 │  triggers: status/reminder invariants│
 │  • push → showNotification│                │  scheduler SQL: refresh / enqueue /  │
 │  • notificationclick ────┼──POST token──▶  │  lease (FOR UPDATE SKIP LOCKED)      │
 │  • offline action queue  │                 │                                      │
 └───────────▲──────────────┘                 │ pg_cron (every minute)               │
             │ Web Push (VAPID, aes128gcm)    │  ├─ run_scheduler_tick()  (pure SQL) │
 ┌───────────┴──────────────┐                 │  └─ pg_net → Edge Fn dispatch        │
 │ Browser push service      │◀── HTTPS ───── │ Edge Fn dispatch-reminders (Deno)    │
 │ (FCM / Mozilla / Apple)   │                │ Edge Fn notification-action (Deno)   │
 └──────────────────────────┘                 └──────────────────────────────────────┘
```

## 2. Reminder pipeline (the critical path)

1. **Scheduling state lives on the task row.** `tasks.next_reminder_at` is the single source of truth. A `BEFORE` trigger sets it on create or reschedule (`coalesce(scheduled_at, due_at)`). A table `CHECK` constraint guarantees that a completed or cancelled task can never have a pending reminder.
2. **Tick (pg_cron, every minute).** `run_scheduler_tick()` runs these steps:
   * `refresh_statuses()`: upcoming → pending → overdue; goals move to at-risk.
   * `enqueue_task_reminders()`: selects due tasks `FOR UPDATE SKIP LOCKED`, applies quiet hours and the daily limit, and inserts a `notifications` row with a unique `dedupe_key = task:<id>:<epoch of scheduled slot>`. It advances `next_reminder_at` by the user's interval (default 60 min), keeping the phase, all in the same transaction.
   * `enqueue_digests()`: morning and evening summaries, goal check-ins, weekly and monthly reviews, goal deadline warnings and habit nudges. Each is deduplicated by user + period.
3. **Dispatch (Edge Function, called by pg_net every minute; it also runs the tick itself).**
   * `lease_notifications()` claims `queued` rows, or `sending` rows whose lease has expired, with `SKIP LOCKED`. It marks rows for completed or cancelled tasks `superseded` and issues a one-time action token per row (only its SHA-256 is stored).
   * It sends Web Push (VAPID) to every active subscription. Each attempt is recorded in `notification_deliveries`. A 404 or 410 disables the subscription. A 429, a 5xx or a network error retries with exponential backoff, up to 5 attempts. If no channel is available, the row becomes `no_channel` and is still shown in the in-app Notification Center.
   * Push options are `Topic = task id` and `TTL = interval`, plus a notification `tag = task id`. If a device is offline, the push service replaces undelivered reminders for the same task instead of piling them up, and the OS replaces the visible notification.
4. **Actions.** The service worker POSTs `{token, action}` to `notification-action`. That function resolves the token to its notification and task, then calls `apply_task_action()`.
   * **complete**: sets status and `completed_at`, clears `next_reminder_at`, and writes history. AFTER triggers then update goal progress, spawn the next recurrence and award badges.
   * **pending**: keeps the task active. The hourly cycle continues.
   * **cancel**: sets status and `cancelled_at`, clears the reminder, and keeps the row.
   * **snooze**: 1 h, 3 h, or tomorrow (next morning in the user's timezone).

   If the request fails while offline, the action is queued in IndexedDB. It is retried on Background Sync, the next push, or the next app open.

**Idempotency layers.** (a) Row locks with `SKIP LOCKED`. (b) An atomic advance of `next_reminder_at`. (c) A unique `dedupe_key`. (d) Lease-based delivery with an attempt counter. (e) A recheck that the task is still active immediately before sending. (f) A notification `tag` and push `Topic`, which collapse anything that slips through on the client side.

## 3. Data model (public schema)

| Table | Purpose |
|---|---|
| `profiles` | 1:1 with `auth.users`: name, timezone (default Asia/Karachi), theme, Pomodoro settings |
| `notification_preferences` | push on/off, interval, quiet hours, daily limit, summaries, goal reminder frequency, sound/vibration |
| `categories`, `projects` | organisation |
| `tasks` | title, description, notes, scheduled_at, due_at, estimate, priority, status (6 states), tags[], recurrence (jsonb), goal link, reminder state |
| `subtasks` | checklist items per task |
| `goals` | weekly / monthly goals, progress modes: `target`, `manual`, `milestones`, `tasks`, `children` (monthly goal ← weekly goals) |
| `goal_milestones` | milestones per goal |
| `task_completion_history` | completed / cancelled / reopened / snoozed events, with source (app / notification / system) |
| `notifications` | queue, delivery log and in-app inbox in one table (status, attempts, lease, read_at, action taken) |
| `notification_deliveries` | one row per push attempt per subscription (status code, error) |
| `push_subscriptions` | endpoint + keys per device; failure counters, disabled reason |
| `habits`, `habit_logs` | recurring habits, daily logs, streaks |
| `focus_sessions` | Pomodoro and focus-mode time tracking (rolls up into `tasks.time_spent_seconds`) |
| `achievements` | goal completions + badges (first goal, streaks, task milestones) |

## 4. Security

* RLS is enabled on every table. Policies use `user_id = (select auth.uid())`. Ownership triggers stop a user from linking their task, subtask or milestone to another user's project, goal or task.
* System-written tables (`notifications` insert, `notification_deliveries`, `achievements`, `task_completion_history`) have no client write grants. Clients may update only `notifications.read_at`.
* Scheduler and dispatcher functions are `SECURITY DEFINER`, with `EXECUTE` revoked from `anon` and `authenticated`.
* Secrets: the VAPID private key, `CRON_SECRET` and the service DB URL live only in Edge Function secrets and Supabase Vault. The browser gets only the VAPID *public* key and the anon key.
* Notification action tokens are 192-bit random values, stored as hashes, scoped to a single task, and expire after 14 days.

## 5. Frontend

Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui-style components (Radix), React Query, Recharts and canvas-confetti.
Routes: `/dashboard`, `/today`, `/upcoming`, `/tasks`, `/calendar`, `/goals`, `/projects`, `/habits`, `/focus`, `/review`, `/analytics`, `/notifications`, `/settings`, `/n` (notification action screen, token-based, works without login), `/login`.
