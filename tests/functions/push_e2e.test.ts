// End-to-end tests of the real Edge Function handlers against real Postgres and an
// HTTPS mock push service. Payloads are decrypted (RFC 8291) and VAPID JWTs verified
// (RFC 8292) exactly as a browser push service / browser would.
//
// Time: these run on the wall clock. "60 minutes later" is simulated by shifting the
// task's stored timestamps back 60 minutes (the pinned-clock DB tests cover the exact
// interval arithmetic).
import webpush from "npm:web-push@3.6.7";
import { assert, assertEquals } from "../assert.ts";
import { asUser, connect, createUser, decryptPush, newSubscriber, startMockPushService, verifyVapid, type Subscriber } from "../helpers.ts";

const vapid = webpush.generateVAPIDKeys();
Deno.env.set("SUPABASE_DB_URL", Deno.env.get("TEST_DB_URL") ?? "postgres://postgres@127.0.0.1:54322/cadence");
Deno.env.set("SUPABASE_URL", "https://project-ref.supabase.co");
// Production configuration: secrets live in Supabase Vault, not in function env vars.
for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "CRON_SECRET", "NOTIFICATION_ACTION_SECRET"]) Deno.env.delete(k);
{
  const admin = connect(1);
  await admin`insert into vault.decrypted_secrets (name, decrypted_secret) values
    ('cadence_vapid_subject', 'mailto:test@cadence.dev'), ('cadence_cron_secret', 'cron-secret-for-tests'),
    ('cadence_action_secret', 'action-secret-for-tests')
    on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`;
  await admin.end();
}

const { handle: dispatchHandler } = await import("../../supabase/functions/dispatch-reminders/handler.ts");
const { handle: actionHandler } = await import("../../supabase/functions/notification-action/handler.ts");

const sql = connect(2);
const push = startMockPushService();

const dispatch = async (secret = "cron-secret-for-tests") => {
  const res = await dispatchHandler(new Request("http://fn/dispatch-reminders", {
    method: "POST", headers: { authorization: `Bearer ${secret}` }, body: "{}",
  }));
  return { status: res.status, body: await res.json() };
};
const act = async (token: string, action: string, minutes?: number) => {
  const res = await actionHandler(new Request("http://fn/notification-action", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" },
    body: JSON.stringify({ token, action, minutes }),
  }));
  return { status: res.status, body: await res.json(), cors: res.headers.get("access-control-allow-origin") };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Payload = any;
async function decoded(name: string, sub: Subscriber): Promise<Payload[]> {
  return await Promise.all(push.for(name).map((p) => decryptPush(sub, p.body)));
}

async function user(email: string) {
  const uid = await createUser(sql, email);
  await sql`update notification_preferences set morning_summary_enabled = false, evening_summary_enabled = false,
            goal_reminder_frequency = 'off', weekly_review_enabled = false, monthly_review_enabled = false
            where user_id = ${uid}`;
  return uid;
}
async function subscribe(uid: string, name: string) {
  const s = await newSubscriber();
  await asUser(sql, uid, (tx) => tx`select register_push_subscription(${push.endpoint(name)}, ${s.p256dh}, ${s.authB64}, 'Test UA')`);
  return s;
}
async function task(uid: string, fields: Record<string, unknown>) {
  const [t] = await asUser(sql, uid, (tx) => tx`insert into tasks ${tx({ title: "Task", ...fields })} returning *`);
  return t;
}
/**
 * Simulate the passage of time for one task: its already-scheduled next reminder
 * (e.g. +60 min) is moved to "just now" so the dispatcher sees it as due.
 * Closed tasks are unaffected (the trigger keeps next_reminder_at null).
 */
async function timeTravel(taskId: string, _min: number) {
  await sql`update tasks set next_reminder_at = now() - interval '1 second'
            where id = ${taskId} and next_reminder_at is not null`;
}
const row = async (id: string) => (await sql`select * from tasks where id = ${id}`)[0];

Deno.test({ name: "edge functions: real push delivery + notification actions", sanitizeResources: false, sanitizeOps: false }, async (t) => {
  await sql`update cron.job set active = false`; // the handler drives ticks itself in this test

  const uid = await user(`e2e_${Date.now()}@test.dev`);
  const subA = await subscribe(uid, "a1");

  let firstTask: Payload;
  await t.step("S1/S2: future task → push arrives at its scheduled time, correctly encrypted & signed", async () => {
    const due = new Date(Date.now() + 4000);
    firstTask = await task(uid, { title: "Prepare sprint demo", scheduled_at: due, priority: "critical" });
    let r = await dispatch();
    assertEquals(r.status, 200);
    assertEquals(push.for("a1").length, 0, "no push before scheduled time");

    await sleep(due.getTime() - Date.now() + 300);
    r = await dispatch();
    assertEquals(r.body.sent, 1, JSON.stringify(r.body));
    const [p] = push.for("a1");
    assert(p.at >= due.getTime() && p.at - due.getTime() < 5000, "delivered within seconds of the scheduled time");
    assertEquals(p.headers["content-encoding"], "aes128gcm");
    assertEquals(p.headers["urgency"], "high");
    assertEquals(p.headers["ttl"], "3600");
    assertEquals(p.headers["topic"], firstTask.id.replace(/-/g, ""));
    const [{ decrypted_secret: vapidPublic }] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'cadence_vapid_public_key'`;
    assert(vapidPublic && vapidPublic !== vapid.publicKey, "VAPID keys generated inside the backend");
    await verifyVapid(p.headers["authorization"], push.origin, vapidPublic);

    const [payload] = await decoded("a1", subA);
    assertEquals(payload.title, "Prepare sprint demo");
    assertEquals(payload.kind, "task_reminder");
    assertEquals(payload.actions, ["complete", "pending", "cancel"]);
    assertEquals(payload.tag, `task-${firstTask.id}`);
    assertEquals(payload.requireInteraction, true);
    assertEquals(payload.actionUrl, "https://project-ref.supabase.co/functions/v1/notification-action");
    assert(typeof payload.token === "string" && payload.token.startsWith(payload.id + "."));
    assert(payload.body.includes("Critical priority"), payload.body);

    const [n] = await sql`select status, sent_at from notifications where id = ${payload.id}`;
    assertEquals(n.status, "sent");
    const [d] = await sql`select * from notification_deliveries where notification_id = ${payload.id}`;
    assertEquals([d.ok, d.status_code], [true, 201]);
  });

  await t.step("S10: repeated / concurrent dispatcher runs don't duplicate", async () => {
    const results = await Promise.all([dispatch(), dispatch(), dispatch(), dispatch()]);
    results.forEach((r) => assertEquals(r.status, 200));
    assertEquals(push.for("a1").length, 1);
  });

  await t.step("S3: still incomplete 60 minutes later → second push", async () => {
    const before = await row(firstTask.id);
    assertEquals(new Date(before.next_reminder_at).getTime() - new Date(firstTask.scheduled_at).getTime(), 3600_000);
    await timeTravel(firstTask.id, 60);
    await dispatch();
    const ps = await decoded("a1", subA);
    assertEquals(ps.length, 2);
    assert(ps[1].body.includes("Reminder 2"), ps[1].body);
  });

  await t.step("S4: Complete from the notification → completed, timestamp, no more pushes", async () => {
    const ps = await decoded("a1", subA);
    const r = await act(ps[1].token, "complete");
    assertEquals(r.status, 200);
    assertEquals(r.body.task.status, "completed");
    assertEquals(r.body.task.next_reminder_at, null);
    assertEquals(r.cors, "*");
    const tk = await row(firstTask.id);
    assert(tk.completed_at);
    const [n] = await sql`select action_taken, read_at from notifications where id = ${ps[1].id}`;
    assertEquals(n.action_taken, "complete");
    assert(n.read_at);
    const [h] = await sql`select source from task_completion_history where task_id = ${firstTask.id} and event = 'completed'`;
    assertEquals(h.source, "notification");
    for (let i = 0; i < 3; i++) {
      await sql`update tasks set scheduled_at = scheduled_at - interval '60 minutes' where id = ${firstTask.id}`;
      await dispatch();
    }
    assertEquals(push.for("a1").length, 2, "never reminded again");
    // Stale button press on an older notification is harmless and idempotent
    const again = await act(ps[0].token, "complete");
    assertEquals([again.status, again.body.task.status], [200, "completed"]);
  });

  await t.step("S5: Pending keeps the reminder cycle going", async () => {
    const tk = await task(uid, { title: "Reply to client", scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    const p = (await decoded("a1", subA)).at(-1);
    assertEquals(p.taskId, tk.id);
    const r = await act(p.token, "pending");
    assertEquals([r.status, r.body.task.status], [200, "pending"]);
    const next = new Date(r.body.task.next_reminder_at).getTime();
    assert(Math.abs(next - (new Date(tk.scheduled_at).getTime() + 3600_000)) < 2000, "next reminder in ~60 min");
    await timeTravel(tk.id, 60);
    await dispatch();
    const last = (await decoded("a1", subA)).at(-1);
    assertEquals(last.taskId, tk.id);
    assert(last.body.includes("Reminder 2"));

    // S6: Cancel stops everything and keeps history
    const c = await act(last.token, "cancel");
    assertEquals([c.status, c.body.task.status], [200, "cancelled"]);
    const count = push.for("a1").length;
    await timeTravel(tk.id, 120);
    await dispatch();
    assertEquals(push.for("a1").length, count, "no push after cancel");
    const closed = await act(last.token, "pending");
    assertEquals([closed.status, closed.body.error], [409, "task_closed"]);
    assertEquals((await row(tk.id)).title, "Reply to client");
  });

  await t.step("Snooze 1h / until tomorrow", async () => {
    const tk = await task(uid, { title: "Snooze me", scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    const p = (await decoded("a1", subA)).at(-1);
    const r = await act(p.token, "snooze", 60);
    assertEquals(r.status, 200);
    assert(Math.abs(new Date(r.body.task.next_reminder_at).getTime() - (Date.now() + 3600_000)) < 5000);
    const n = push.for("a1").length;
    await dispatch();
    assertEquals(push.for("a1").length, n, "no push while snoozed");
    const r2 = await act(p.token, "snooze_tomorrow");
    const [lt] = await sql`select to_char(${r2.body.task.next_reminder_at}::timestamptz at time zone 'Asia/Karachi', 'HH24:MI') as l`;
    assertEquals(lt.l, "08:00", "tomorrow 08:00 Asia/Karachi");
    assertEquals((await row(tk.id)).status, "pending");
  });

  await t.step("action endpoint rejects bad tokens and input", async () => {
    const p = (await decoded("a1", subA)).at(-1);
    assertEquals((await act(p.token.slice(0, -2) + "xx", "complete")).status, 401);
    assertEquals((await act(`${crypto.randomUUID()}.${p.token.split(".")[1]}`, "complete")).status, 401);
    assertEquals((await act("garbage", "complete")).status, 401);
    assertEquals((await act(p.token, "delete_everything")).status, 400);
    assertEquals((await act(p.token, "snooze", 1)).status, 400);
    const get = await actionHandler(new Request(`http://fn/notification-action?token=${encodeURIComponent(p.token)}`));
    const body = await get.json();
    assertEquals(get.status, 200);
    assertEquals(body.task.title, "Snooze me");
    const opt = await actionHandler(new Request("http://fn/notification-action", { method: "OPTIONS" }));
    assertEquals(opt.status, 204);
    assertEquals((await dispatch("wrong-secret")).status, 401);
  });

  await t.step("expired subscription (410) is disabled; other devices still receive", async () => {
    const ub = await user(`multi_${Date.now()}@test.dev`);
    const ok = await subscribe(ub, "b-ok");
    await subscribe(ub, "b-gone");
    push.behaviour.set("/push/b-gone", 410);
    const tk = await task(ub, { title: "Two devices", scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    assertEquals(push.for("b-ok").length, 1);
    assertEquals(push.for("b-gone").length, 1);
    const subs = await sql`select endpoint, disabled_at, disabled_reason from push_subscriptions where user_id = ${ub} order by endpoint`;
    const gone = subs.find((s) => s.endpoint.endsWith("b-gone"))!;
    assertEquals(gone.disabled_reason, "expired (410)");
    const [n] = await sql`select status from notifications where task_id = ${tk.id}`;
    assertEquals(n.status, "partial");
    await timeTravel(tk.id, 60);
    await dispatch();
    assertEquals(push.for("b-ok").length, 2);
    assertEquals(push.for("b-gone").length, 1, "disabled subscription is not retried");
    assertEquals((await decoded("b-ok", ok)).length, 2);
  });

  await t.step("push service outage (503) → retried with backoff, then delivered", async () => {
    const uc = await user(`flaky_${Date.now()}@test.dev`);
    await subscribe(uc, "c-flaky");
    push.behaviour.set("/push/c-flaky", 503);
    const tk = await task(uc, { title: "Flaky", scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    let [n] = await sql`select * from notifications where task_id = ${tk.id}`;
    assertEquals([n.status, n.attempts], ["sending", 1]);
    assert(new Date(n.lease_until).getTime() > Date.now(), "backoff scheduled");
    await dispatch();
    assertEquals(push.for("c-flaky").length, 1, "not retried during backoff");
    push.behaviour.delete("/push/c-flaky");
    await sql`update notifications set lease_until = now() - interval '1 second' where id = ${n.id}`;
    await dispatch();
    [n] = await sql`select * from notifications where id = ${n.id}`;
    assertEquals([n.status, n.attempts], ["sent", 2]);
    const ds = await sql`select ok, status_code from notification_deliveries where notification_id = ${n.id} order by id`;
    assertEquals(ds.map((d) => [d.ok, d.status_code]), [[false, 503], [true, 201]]);
  });

  await t.step("S9 (server side): push disabled / no subscription → in-app notification still recorded", async () => {
    const ud = await user(`nopush_${Date.now()}@test.dev`);
    await sql`update notification_preferences set push_enabled = false where user_id = ${ud}`;
    const tk = await task(ud, { title: "In-app only", scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    const inbox = await asUser(sql, ud, (tx) => tx`select title, status, read_at from notifications where task_id = ${tk.id}`);
    assertEquals(inbox.map((x) => [x.title, x.status, x.read_at]), [["In-app only", "no_channel", null]]);
  });

  await t.step("S8: completing the last task of a weekly goal from a notification completes the goal", async () => {
    const [g] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Launch landing page", period: "weekly", start_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10) })} returning *`);
    const tk = await task(uid, { title: "Publish page", goal_id: g.id, scheduled_at: new Date(Date.now() - 1000) });
    await dispatch();
    const p = (await decoded("a1", subA)).find((x) => x.taskId === tk.id);
    await act(p.token, "complete");
    const [gg] = await sql`select status, progress_pct from goals where id = ${g.id}`;
    assertEquals([gg.status, Number(gg.progress_pct)], ["completed", 100]);
    await dispatch();
    const ach = (await decoded("a1", subA)).find((x) => x.kind === "achievement");
    assert(ach, "achievement push delivered");
    assertEquals(ach.title, "Weekly goal achieved");
    assertEquals(ach.actions, []);
  });

  push.close();
  await sql`update cron.job set active = true`;
  await sql.end();
});
