// Handles the Complete / Pending / Cancel / Snooze buttons of a reminder.
// Called by the service worker (tab may be closed, no user session) and by the
// /n action screen. Authorisation = HMAC-signed, per-notification token.
import { db } from "../_shared/db.ts";
import { secret } from "../_shared/env.ts";
import { corsHeaders, json, log } from "../_shared/http.ts";
import { TOKEN_MAX_AGE_DAYS, verifyActionToken } from "../_shared/token.ts";

const ACTIONS = new Set(["complete", "pending", "cancel", "snooze", "snooze_tomorrow"]);

async function resolve(token: unknown) {
  const id = await verifyActionToken(await secret("NOTIFICATION_ACTION_SECRET"), token);
  if (!id) return null;
  const sql = db();
  const [n] = await sql`
    select n.id, n.user_id, n.kind, n.task_id, n.title, n.body, n.created_at, n.action_taken, n.action_at
    from public.notifications n
    where n.id = ${id} and n.created_at > now() - make_interval(days => ${TOKEN_MAX_AGE_DAYS})`;
  return n ?? null;
}

async function taskSnapshot(taskId: string) {
  const [t] = await db()`
    select t.id, t.title, t.description, t.status, t.priority, t.scheduled_at, t.due_at,
           t.next_reminder_at, t.snoozed_until, t.completed_at, t.cancelled_at, t.recurrence is not null as recurring,
           p.timezone
    from public.tasks t join public.profiles p on p.id = t.user_id
    where t.id = ${taskId}`;
  return t ?? null;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token");
      const n = await resolve(token);
      if (!n) return json(req, { error: "invalid_or_expired_token" }, 401);
      const task = n.task_id ? await taskSnapshot(n.task_id) : null;
      return json(req, {
        notification: { id: n.id, kind: n.kind, title: n.title, body: n.body, created_at: n.created_at, action_taken: n.action_taken },
        task,
      });
    }

    if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

    let body: { token?: unknown; action?: unknown; minutes?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "invalid_json" }, 400);
    }
    const action = String(body.action ?? "");
    if (!ACTIONS.has(action)) return json(req, { error: "invalid_action" }, 400);
    const minutes = action === "snooze" ? Number(body.minutes ?? 60) : null;
    if (action === "snooze" && (!Number.isInteger(minutes) || minutes! < 5 || minutes! > 10080)) {
      return json(req, { error: "invalid_minutes" }, 400);
    }

    const n = await resolve(body.token);
    if (!n) return json(req, { error: "invalid_or_expired_token" }, 401);
    if (!n.task_id) return json(req, { error: "not_a_task_notification" }, 400);

    const sql = db();
    try {
      const [{ result }] = await sql`
        select public.apply_task_action(${n.task_id}, ${n.user_id}, ${action}, 'notification', ${minutes}, 'occurrence') as result`;
      await sql`
        update public.notifications
        set action_taken = ${action === "snooze_tomorrow" ? "snooze" : action}, action_at = now(),
            read_at = coalesce(read_at, now())
        where id = ${n.id}`;
      log("info", "notification action", { notification: n.id, task: n.task_id, action });
      return json(req, { ok: true, action, task: result });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("task_closed")) {
        return json(req, { ok: false, error: "task_closed", task: await taskSnapshot(n.task_id) }, 409);
      }
      if (msg.includes("task_not_found")) return json(req, { ok: false, error: "task_not_found" }, 404);
      throw e;
    }
  } catch (e) {
    log("error", "notification-action failed", { error: String(e) });
    return json(req, { error: "internal_error" }, 500);
  }
}
