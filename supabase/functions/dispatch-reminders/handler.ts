// Delivery worker. Invoked every minute by pg_cron (pg_net) and safe to invoke
// concurrently or repeatedly: every step is lease-based and idempotent.
import { db } from "../_shared/db.ts";
import { env, optionalEnv, secret } from "../_shared/env.ts";
import { json, log, timingSafeEqual } from "../_shared/http.ts";
import { sendPush, topicFor, type PushResult } from "../_shared/push.ts";
import { signActionToken } from "../_shared/token.ts";

const BATCH = 100;
const LEASE_SECONDS = 120;
const CONCURRENCY = 8;

interface LeasedNotification {
  id: string;
  user_id: string;
  kind: string;
  task_id: string | null;
  goal_id: string | null;
  title: string;
  body: string;
  url: string;
  attempts: number;
  scheduled_for: Date;
}

interface Prefs {
  push_enabled: boolean;
  sound_enabled: boolean;
  vibrate_enabled: boolean;
  require_interaction: boolean;
  reminder_interval_minutes: number;
}

type Outcome = "sent" | "partial" | "failed" | "no_channel" | "retry" | "superseded";

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function buildPayload(n: LeasedNotification, prefs: Prefs | undefined, token: string, actionUrl: string) {
  const isTask = n.kind === "task_reminder" && !!n.task_id;
  return {
    v: 1,
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    url: n.url,
    tag: isTask ? `task-${n.task_id}` : `${n.kind}-${n.id}`,
    taskId: n.task_id,
    goalId: n.goal_id,
    token,
    actionUrl,
    actions: isTask ? ["complete", "pending", "cancel"] : [],
    requireInteraction: isTask && (prefs?.require_interaction ?? true),
    silent: !(prefs?.sound_enabled ?? true),
    vibrate: prefs?.vibrate_enabled ?? true,
    timestamp: new Date(n.scheduled_for).getTime(),
  };
}

async function deliver(n: LeasedNotification): Promise<Outcome> {
  const sql = db();

  // Last-moment guard: the user may have completed/cancelled the task after it was leased.
  if (n.kind === "task_reminder") {
    const [t] = n.task_id ? await sql`select status from public.tasks where id = ${n.task_id}` : [];
    if (!t || t.status === "completed" || t.status === "cancelled") {
      await sql`update public.notifications set status = 'superseded', lease_until = null
                where id = ${n.id} and status = 'sending'`;
      return "superseded";
    }
  }

  const [prefs] = await sql<Prefs[]>`
    select push_enabled, sound_enabled, vibrate_enabled, require_interaction, reminder_interval_minutes
    from public.notification_preferences where user_id = ${n.user_id}`;

  const subs = prefs?.push_enabled === false ? [] : await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from public.push_subscriptions
    where user_id = ${n.user_id} and disabled_at is null`;

  if (subs.length === 0) {
    // Still visible in the in-app Notification Center (and as a realtime toast if the app is open).
    await sql`select public.finish_notification(${n.id}, 'no_channel', 'no active push subscription or push disabled')`;
    return "no_channel";
  }

  const token = await signActionToken(await secret("NOTIFICATION_ACTION_SECRET"), n.id);
  const actionUrl = `${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/notification-action`;
  const payload = buildPayload(n, prefs, token, actionUrl);
  const isTask = n.kind === "task_reminder";
  const ttl = isTask ? Math.max(300, (prefs?.reminder_interval_minutes ?? 60) * 60) : 6 * 3600;

  const results: PushResult[] = await Promise.all(subs.map((s) =>
    sendPush(s, payload, {
      ttlSeconds: ttl,
      urgency: isTask ? "high" : "normal",
      topic: isTask && n.task_id ? topicFor(n.task_id) : undefined,
    })
  ));

  for (const r of results) {
    await sql`insert into public.notification_deliveries (notification_id, subscription_id, attempt, ok, status_code, error)
              values (${n.id}, ${r.subscriptionId}, ${n.attempts}, ${r.ok}, ${r.statusCode}, ${r.error ?? null})`;
    if (r.ok) {
      await sql`update public.push_subscriptions set last_success_at = now(), failure_count = 0 where id = ${r.subscriptionId}`;
    } else if (r.gone) {
      await sql`update public.push_subscriptions
                set disabled_at = now(), disabled_reason = ${`expired (${r.statusCode})`}, last_failure_at = now()
                where id = ${r.subscriptionId}`;
    } else {
      await sql`update public.push_subscriptions
                set failure_count = failure_count + 1, last_failure_at = now(),
                    disabled_at = case when failure_count + 1 >= 20 then now() end,
                    disabled_reason = case when failure_count + 1 >= 20 then 'too many consecutive failures' end
                where id = ${r.subscriptionId}`;
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const firstError = results.find((r) => !r.ok)?.error ?? null;
  if (ok === results.length) {
    await sql`select public.finish_notification(${n.id}, 'sent')`;
    return "sent";
  }
  if (ok > 0) {
    await sql`select public.finish_notification(${n.id}, 'partial', ${firstError})`;
    return "partial";
  }
  if (results.some((r) => r.retryable)) {
    const backoff = Math.min(1800, 30 * 2 ** Math.max(0, n.attempts - 1)); // 30s, 60s, 120s, 240s…
    await sql`select public.finish_notification(${n.id}, 'retry', ${firstError}, ${backoff})`;
    return "retry";
  }
  if (results.every((r) => r.gone)) {
    await sql`select public.finish_notification(${n.id}, 'no_channel', ${firstError})`;
    return "no_channel";
  }
  await sql`select public.finish_notification(${n.id}, 'failed', ${firstError})`;
  return "failed";
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const expected = await secret("CRON_SECRET");
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got || !timingSafeEqual(got, expected)) return json(req, { error: "unauthorized" }, 401);

  const started = Date.now();
  const budgetMs = Number(optionalEnv("DISPATCH_BUDGET_MS") ?? 40_000);
  const sql = db();
  const stats: Record<Outcome, number> = { sent: 0, partial: 0, failed: 0, no_channel: 0, retry: 0, superseded: 0 };

  try {
    const [{ tick }] = await sql`select public.run_scheduler_tick() as tick`;
    let leased = 0;
    while (Date.now() - started < budgetMs) {
      const batch = await sql<LeasedNotification[]>`select * from public.lease_notifications(${BATCH}, ${LEASE_SECONDS})`;
      if (batch.length === 0) break;
      leased += batch.length;
      const outcomes = await mapLimit(batch, CONCURRENCY, async (n) => {
        try {
          return await deliver(n);
        } catch (e) {
          log("error", "deliver failed", { notification: n.id, error: String(e) });
          // Leave it leased; the lease expires and the next run retries it.
          return "retry" as Outcome;
        }
      });
      outcomes.forEach((o) => stats[o]++);
      if (batch.length < BATCH) break;
    }
    const result = { ok: true, tick, leased, ...stats, ms: Date.now() - started };
    log("info", "dispatch complete", result);
    return json(req, result);
  } catch (e) {
    log("error", "dispatch crashed", { error: String(e) });
    return json(req, { ok: false, error: "dispatch_failed" }, 500);
  }
}
