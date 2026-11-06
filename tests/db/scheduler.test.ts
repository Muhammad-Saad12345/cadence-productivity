// Database-level tests for the reminder scheduler, task/goal logic and RLS.
// Runs against a real PostgreSQL 16 + pg_cron with the Supabase shim.
// The scheduler clock is pinned per connection (cadence.now), so timing is exact.
import { assert, assertEquals, assertRejects } from "../assert.ts";
import { addMin, asAnon, asUser, connect, createUser, pinClock, type Sql } from "../helpers.ts";

// Monday 10 Nov 2026, 10:00 Asia/Karachi
const T0 = new Date("2026-11-09T10:00:00+05:00");
const ms = (d: Date | string) => new Date(d).getTime();

const sql = connect(1);
let seq = 0;
async function freshUser(prefs: Record<string, unknown> = {}) {
  const uid = await createUser(sql, `user${Date.now()}_${seq++}@test.dev`);
  // Keep digests out of the way unless a test opts in.
  await sql`update notification_preferences set morning_summary_enabled = false, evening_summary_enabled = false,
            goal_reminder_frequency = 'off', weekly_review_enabled = false, monthly_review_enabled = false,
            habit_reminders_enabled = false where user_id = ${uid}`;
  if (Object.keys(prefs).length) {
    await sql`update notification_preferences set ${sql(prefs)} where user_id = ${uid}`;
  }
  return uid;
}
async function newTask(uid: string, fields: Record<string, unknown>) {
  const [t] = await asUser(sql, uid, (tx) => tx`insert into tasks ${tx({ title: "Task", ...fields })} returning *`);
  return t;
}
const tick = async (at: Date) => {
  await pinClock(sql, at);
  const [{ r }] = await sql`select run_scheduler_tick(${at}) as r`;
  return r;
};
const reminders = (taskId: string) =>
  sql`select * from notifications where task_id = ${taskId} and kind = 'task_reminder' order by scheduled_for`;
const task = async (id: string) => (await sql`select * from tasks where id = ${id}`)[0];
const action = async (uid: string, taskId: string, a: string, minutes: number | null = null, source = "notification") =>
  (await sql`select apply_task_action(${taskId}, ${uid}, ${a}, ${source}, ${minutes}) as r`)[0].r;

Deno.test({ name: "scheduler & domain logic", sanitizeResources: false, sanitizeOps: false }, async (t) => {
  // Pause the real pg_cron jobs so wall-clock ticks don't interleave with the pinned-clock tests.
  await sql`update cron.job set active = false`;
  await t.step("S1–S4: future task → first reminder on time → hourly repeat → complete stops it", async () => {
    await pinClock(sql, addMin(T0, -120));
    const uid = await freshUser();
    const tk = await newTask(uid, { title: "Submit DBMS assignment", scheduled_at: T0, due_at: addMin(T0, 180), priority: "high" });
    assertEquals(tk.status, "upcoming");
    assertEquals(ms(tk.next_reminder_at), ms(T0), "reminder scheduled at the task time");

    await tick(addMin(T0, -1));
    assertEquals((await reminders(tk.id)).length, 0, "nothing before the scheduled time");

    await tick(addMin(T0, 0.33));
    let rs = await reminders(tk.id);
    assertEquals(rs.length, 1, "first reminder at scheduled time");
    assertEquals(ms(rs[0].scheduled_for), ms(T0));
    assertEquals(rs[0].title, "Submit DBMS assignment");
    assert(rs[0].body.includes("High priority"), rs[0].body);
    let cur = await task(tk.id);
    assertEquals(ms(cur.next_reminder_at), ms(addMin(T0, 60)), "next reminder +60 min");
    assertEquals(cur.status, "pending");

    for (let i = 0; i < 3; i++) await tick(addMin(T0, 0.5));
    await tick(addMin(T0, 30));
    assertEquals((await reminders(tk.id)).length, 1, "no duplicates, nothing at +30 min");

    await tick(addMin(T0, 60.1));
    rs = await reminders(tk.id);
    assertEquals(rs.length, 2, "second reminder after 60 minutes");
    assert(rs[1].body.includes("Reminder 2"), rs[1].body);

    // Backend outage of 2.5h: exactly one catch-up reminder, phase preserved.
    await tick(addMin(T0, 210));
    rs = await reminders(tk.id);
    assertEquals(rs.length, 3);
    cur = await task(tk.id);
    assertEquals(cur.status, "overdue", "past deadline → overdue");
    assertEquals(ms(cur.next_reminder_at), ms(addMin(T0, 240)));

    await pinClock(sql, addMin(T0, 215));
    const res = await action(uid, tk.id, "complete");
    assertEquals(res.status, "completed");
    assertEquals(res.next_reminder_at, null);
    cur = await task(tk.id);
    assertEquals(ms(cur.completed_at), ms(addMin(T0, 215)), "completion timestamp saved");
    const [h] = await sql`select * from task_completion_history where task_id = ${tk.id} and event = 'completed'`;
    assertEquals(h.source, "notification");

    for (const m of [240, 300, 600, 6000]) await tick(addMin(T0, m));
    assertEquals((await reminders(tk.id)).length, 3, "no reminder ever again after completion");

    // Even a privileged write cannot re-arm a reminder on a closed task:
    await sql`update tasks set next_reminder_at = now() where id = ${tk.id}`;
    assertEquals((await task(tk.id)).next_reminder_at, null, "trigger keeps it null");
    // …and with the trigger bypassed, the CHECK constraint still refuses it.
    await assertRejects(
      () => sql.begin(async (tx) => {
        await tx`alter table tasks disable trigger tasks_before_write`;
        await tx`update tasks set next_reminder_at = now() where id = ${tk.id}`;
      }),
      Error, "tasks_no_reminder_when_closed", "DB constraint forbids reminders on closed tasks");
  });

  await t.step("S5: Pending keeps the hourly cycle; snooze 3h / tomorrow; S6: cancel stops", async () => {
    await pinClock(sql, addMin(T0, -10));
    const uid = await freshUser();
    const tk = await newTask(uid, { title: "Call supplier", scheduled_at: T0 });
    await tick(addMin(T0, 0.2));
    await pinClock(sql, addMin(T0, 2));
    const r = await action(uid, tk.id, "pending");
    assertEquals(r.status, "pending");
    assertEquals(ms(r.next_reminder_at), ms(addMin(T0, 60)), "cycle continues");
    await tick(addMin(T0, 61));
    assertEquals((await reminders(tk.id)).length, 2, "reminded again after Pending");

    await pinClock(sql, addMin(T0, 62));
    const s = await action(uid, tk.id, "snooze", 180);
    assertEquals(ms(s.next_reminder_at), ms(addMin(T0, 242)));
    await tick(addMin(T0, 125));
    assertEquals((await reminders(tk.id)).length, 2, "snoozed: no hourly reminder");
    await tick(addMin(T0, 243));
    assertEquals((await reminders(tk.id)).length, 3, "reminds when snooze ends");

    await pinClock(sql, addMin(T0, 250));
    const st = await action(uid, tk.id, "snooze_tomorrow");
    assertEquals(ms(st.next_reminder_at), ms("2026-11-10T08:00:00+05:00"), "tomorrow 08:00 local");

    await pinClock(sql, addMin(T0, 255));
    const c = await action(uid, tk.id, "cancel");
    assertEquals(c.status, "cancelled");
    assertEquals(c.next_reminder_at, null);
    assert(c.cancelled_at);
    for (const m of [300, 1500, 3000]) await tick(addMin(T0, m));
    assertEquals((await reminders(tk.id)).length, 3, "no reminders after cancel");
    const [h] = await sql`select count(*)::int n from task_completion_history where task_id = ${tk.id} and event = 'cancelled'`;
    assertEquals(h.n, 1, "cancel preserved in history");
    assertEquals((await task(tk.id)).title, "Call supplier", "task row kept");
    await assertRejects(() => action(uid, tk.id, "pending"), Error, "task_closed");
  });

  await t.step("queued reminder is superseded if the task is completed before delivery", async () => {
    await pinClock(sql, T0);
    const uid = await freshUser();
    const tk = await newTask(uid, { title: "Race", scheduled_at: addMin(T0, -1) });
    await tick(T0);
    assertEquals((await reminders(tk.id))[0].status, "queued");
    await asUser(sql, uid, (tx) => tx`update tasks set status = 'completed' where id = ${tk.id}`);
    const leased = await sql`select * from lease_notifications(100, 120, ${T0})`;
    assert(!leased.some((l) => l.task_id === tk.id), "not leased");
    assertEquals((await reminders(tk.id))[0].status, "superseded");
  });

  await t.step("S10: concurrent scheduler runs never duplicate notifications or leases", async () => {
    const at = addMin(T0, 0.1);
    await pinClock(sql, addMin(T0, -5));
    const uid = await freshUser();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await newTask(uid, { title: `Bulk ${i}`, scheduled_at: T0 })).id);

    const workers = Array.from({ length: 6 }, () => connect(1));
    await Promise.all(workers.map((w) => pinClock(w, at)));
    await Promise.all(workers.map((w) => w`select run_scheduler_tick(${at})`));
    await Promise.all(workers.map((w) => w`select run_scheduler_tick(${at})`));
    const [{ n }] = await sql`select count(*)::int n from notifications where task_id = any(${ids}) and kind = 'task_reminder'`;
    assertEquals(n, 25, "exactly one reminder per task");

    const leases = (await Promise.all(workers.map((w) => w`select id from lease_notifications(10, 120, ${at})`))).flat();
    const mine = leases.filter((l) => true).map((l) => l.id);
    assertEquals(new Set(mine).size, mine.length, "no notification leased twice");
    const [{ m }] = await sql`select count(*)::int m from notifications where task_id = any(${ids}) and status = 'sending'`;
    assert(m > 0 && m <= 25);
    await Promise.all(workers.map((w) => w.end()));
  });

  await t.step("lease retry with backoff, then failed after 5 attempts", async () => {
    await pinClock(sql, T0);
    const uid = await freshUser();
    await sql`update notifications set status = 'superseded' where status in ('queued','sending')`;
    const [n] = await sql`insert into notifications (user_id, kind, title, dedupe_key, scheduled_for)
                          values (${uid}, 'system', 'x', ${"retry:" + uid}, ${T0}) returning id`;
    let now = T0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const l = await sql`select * from lease_notifications(100, 120, ${now})`;
      assertEquals(l.map((x) => x.id), [n.id], `leased on attempt ${attempt}`);
      assertEquals(l[0].attempts, attempt);
      await pinClock(sql, now);
      await sql`select finish_notification(${n.id}, 'retry', 'HTTP 503', 60)`;
      const again = await sql`select * from lease_notifications(100, 120, ${addMin(now, 0.5)})`;
      assertEquals(again.length, 0, "not re-leased during backoff");
      now = addMin(now, 1.1);
    }
    const [row] = await sql`select status, attempts, last_error from notifications where id = ${n.id}`;
    assertEquals(row.status, "failed");
    assertEquals(row.attempts, 5);
  });

  await t.step("quiet hours defer (not drop) reminders", async () => {
    const night = new Date("2026-11-09T23:00:00+05:00");
    await pinClock(sql, addMin(night, -60));
    const uid = await freshUser({ quiet_hours_enabled: true, quiet_start: "22:30", quiet_end: "07:00" });
    const tk = await newTask(uid, { title: "Late", scheduled_at: night });
    await tick(addMin(night, 1));
    assertEquals((await reminders(tk.id)).length, 0);
    assertEquals(ms((await task(tk.id)).next_reminder_at), ms("2026-11-10T07:00:00+05:00"));
    await tick(new Date("2026-11-10T07:00:30+05:00"));
    assertEquals((await reminders(tk.id)).length, 1, "delivered when quiet hours end");
  });

  await t.step("daily notification limit", async () => {
    await pinClock(sql, addMin(T0, -5));
    const uid = await freshUser({ daily_limit: 2 });
    const ts = [];
    for (let i = 0; i < 3; i++) ts.push(await newTask(uid, { title: `L${i}`, scheduled_at: T0 }));
    await tick(addMin(T0, 0.2));
    const [{ n }] = await sql`select count(*)::int n from notifications where user_id = ${uid}`;
    assertEquals(n, 2, "capped at 2 per day");
    const deferred = (await Promise.all(ts.map((x) => task(x.id)))).filter((x) => x.reminder_count === 0);
    assertEquals(deferred.length, 1);
    assertEquals(ms(deferred[0].next_reminder_at), ms("2026-11-10T08:00:00+05:00"), "deferred to tomorrow morning");
  });

  await t.step("overdue status refresh", async () => {
    await pinClock(sql, addMin(T0, -30));
    const uid = await freshUser();
    const tk = await newTask(uid, { title: "Deadline only", due_at: T0 });
    assertEquals(tk.status, "pending");
    await tick(addMin(T0, 1));
    assertEquals((await task(tk.id)).status, "overdue");
    await asUser(sql, uid, (tx) => tx`update tasks set due_at = ${addMin(T0, 600)} where id = ${tk.id}`);
    assertEquals((await task(tk.id)).status, "pending", "rescheduling clears overdue");
  });

  await t.step("recurring tasks spawn the next occurrence (daily, weekdays, weekly, monthly)", async () => {
    await pinClock(sql, T0);
    const uid = await freshUser();
    const nine = new Date("2026-11-09T09:00:00+05:00");
    const d = await newTask(uid, { title: "Daily standup", scheduled_at: nine, recurrence: sql.json({ freq: "daily" }) });
    await asUser(sql, uid, (tx) => tx`insert into subtasks (task_id, title, done) values (${d.id}, 'notes', true)`);
    await action(uid, d.id, "complete");
    const [n1] = await sql`select * from tasks where series_id = ${d.series_id} and id <> ${d.id}`;
    assertEquals(ms(n1.scheduled_at), ms("2026-11-10T09:00:00+05:00"));
    assertEquals(n1.status, "upcoming");
    const [st] = await sql`select * from subtasks where task_id = ${n1.id}`;
    assertEquals([st.title, st.done], ["notes", false], "subtasks copied, reset");
    await action(uid, d.id, "reopen", null, "app");
    await action(uid, d.id, "complete");
    const [{ c }] = await sql`select count(*)::int c from tasks where series_id = ${d.series_id}`;
    assertEquals(c, 2, "re-completing never duplicates an occurrence");

    const fri = new Date("2026-11-13T09:00:00+05:00");
    await pinClock(sql, addMin(fri, 30));
    const w = await newTask(uid, { title: "Weekday", scheduled_at: fri, recurrence: sql.json({ freq: "weekdays" }) });
    await action(uid, w.id, "complete");
    const [wn] = await sql`select scheduled_at from tasks where series_id = ${w.series_id} and id <> ${w.id}`;
    assertEquals(ms(wn.scheduled_at), ms("2026-11-16T09:00:00+05:00"), "Friday → Monday");

    await pinClock(sql, T0);
    const k = await newTask(uid, { title: "Gym", scheduled_at: nine, recurrence: sql.json({ freq: "weekly", byweekday: [1, 3] }) });
    await action(uid, k.id, "complete");
    const [kn] = await sql`select scheduled_at from tasks where series_id = ${k.series_id} and id <> ${k.id}`;
    assertEquals(ms(kn.scheduled_at), ms("2026-11-11T09:00:00+05:00"), "Mon → Wed");

    const jan31 = new Date("2027-01-31T09:00:00+05:00");
    await pinClock(sql, addMin(jan31, 60));
    const m = await newTask(uid, { title: "Rent", scheduled_at: jan31, recurrence: sql.json({ freq: "monthly" }) });
    await action(uid, m.id, "complete");
    const [mn] = await sql`select scheduled_at from tasks where series_id = ${m.series_id} and id <> ${m.id}`;
    assertEquals(ms(mn.scheduled_at), ms("2027-02-28T09:00:00+05:00"), "end-of-month clamp");

    await pinClock(sql, T0);
    const s = await newTask(uid, { title: "Series end", scheduled_at: nine, recurrence: sql.json({ freq: "daily" }) });
    await asUser(sql, uid, (tx) => tx`select task_action(${s.id}, 'cancel', null, 'series')`);
    const [{ sc }] = await sql`select count(*)::int sc from tasks where series_id = ${s.series_id}`;
    assertEquals(sc, 1, "cancel series → no next occurrence");
  });

  await t.step("S8: goals — task/milestone/target/children progress, completion, achievements", async () => {
    await pinClock(sql, T0);
    const uid = await freshUser();
    const [month] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Ship MVP", period: "monthly", start_date: "2026-11-01", due_date: "2026-11-30", progress_mode: "children" })} returning *`);
    const [week] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Finish auth module", period: "weekly", start_date: "2026-11-09", due_date: "2026-11-15",
      progress_mode: "tasks", parent_goal_id: month.id })} returning *`);
    const [week2] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Write docs", period: "weekly", start_date: "2026-11-09", due_date: "2026-11-15",
      progress_mode: "milestones", parent_goal_id: month.id })} returning *`);
    const a = await newTask(uid, { title: "Login page", goal_id: week.id });
    const b = await newTask(uid, { title: "Signup page", goal_id: week.id });

    await action(uid, a.id, "complete", null, "app");
    let [g] = await sql`select * from goals where id = ${week.id}`;
    assertEquals([Number(g.progress_pct), g.status], [50, "in_progress"]);

    await action(uid, b.id, "complete", null, "notification");
    [g] = await sql`select * from goals where id = ${week.id}`;
    assertEquals([Number(g.progress_pct), g.status], [100, "completed"]);
    assert(g.completed_at);
    const [ach] = await sql`select * from achievements where goal_id = ${week.id}`;
    assertEquals(ach.title, "Weekly goal achieved");
    const [an] = await sql`select * from notifications where goal_id = ${week.id} and kind = 'achievement'`;
    assertEquals(an.status, "queued", "celebration push queued");
    const badges = (await sql`select code from achievements where user_id = ${uid} and kind = 'badge'`).map((x) => x.code);
    assert(badges.includes("first_goal"), String(badges));

    let [mg] = await sql`select * from goals where id = ${month.id}`;
    assertEquals(Number(mg.progress_pct), 50, "monthly = avg(children)");

    const ms_ = await asUser(sql, uid, (tx) => tx`insert into goal_milestones (goal_id, title, position)
      select ${week2.id}, 'M' || i, i from generate_series(1,4) i returning id`);
    await asUser(sql, uid, (tx) => tx`update goal_milestones set done = true where id = any(${[ms_[0].id, ms_[1].id]})`);
    [g] = await sql`select * from goals where id = ${week2.id}`;
    assertEquals(Number(g.progress_pct), 50);
    [mg] = await sql`select * from goals where id = ${month.id}`;
    assertEquals(Number(mg.progress_pct), 75);

    const [tg] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Read 10 chapters", period: "weekly", start_date: "2026-11-09", due_date: "2026-11-15",
      progress_mode: "target", target_value: 10, current_value: 4, unit: "chapters" })} returning *`);
    assertEquals([Number(tg.progress_pct), tg.status], [40, "in_progress"]);
    await asUser(sql, uid, (tx) => tx`update goals set current_value = 10 where id = ${tg.id}`);
    [g] = await sql`select * from goals where id = ${tg.id}`;
    assertEquals(g.status, "completed");

    // At-risk: 6 of 7 days elapsed, 10% done.
    const [risk] = await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Behind", period: "weekly", start_date: "2026-11-04", due_date: "2026-11-10",
      progress_mode: "manual", progress_pct: 10 })} returning *`);
    await tick(T0);
    [g] = await sql`select status from goals where id = ${risk.id}`;
    assertEquals(g.status, "at_risk");
  });

  await t.step("digests: morning/evening/goal check-in/weekly review/deadline/habit — each exactly once", async () => {
    const day = "2026-11-15"; // Sunday
    await pinClock(sql, `${day}T06:00:00+05:00`);
    const uid = await freshUser({
      morning_summary_enabled: true, evening_summary_enabled: true, goal_reminder_frequency: "daily",
      weekly_review_enabled: true, habit_reminders_enabled: true,
    });
    await newTask(uid, { title: "Today thing", scheduled_at: `${day}T15:00:00+05:00`, priority: "critical" });
    await asUser(sql, uid, (tx) => tx`insert into goals ${tx({
      title: "Weekly target", period: "weekly", start_date: "2026-11-09", due_date: day, progress_mode: "manual", progress_pct: 30 })}`);
    const [hb] = await asUser(sql, uid, (tx) => tx`insert into habits (name, reminder_time) values ('Read', '20:00') returning id`);

    const kinds = async () =>
      (await sql`select kind from notifications where user_id = ${uid} order by created_at`).map((x) => x.kind);
    await tick(new Date(`${day}T07:55:00+05:00`));
    assert(!(await kinds()).includes("morning_summary"), "not before 08:00");
    for (let i = 0; i < 3; i++) await tick(new Date(`${day}T08:05:00+05:00`));
    await tick(new Date(`${day}T09:30:00+05:00`));
    assertEquals((await kinds()).filter((k) => k === "morning_summary").length, 1);
    const [m] = await sql`select body from notifications where user_id = ${uid} and kind = 'morning_summary'`;
    assert(m.body.includes("Today thing"), m.body);
    assert((await kinds()).includes("goal_deadline"), "deadline warning within 24h");

    await tick(new Date(`${day}T18:10:00+05:00`));
    await tick(new Date(`${day}T18:40:00+05:00`));
    await tick(new Date(`${day}T20:01:00+05:00`));
    await tick(new Date(`${day}T21:31:00+05:00`));
    await tick(new Date(`${day}T21:45:00+05:00`));
    const k = await kinds();
    for (const kind of ["goal_checkin", "evening_summary", "weekly_review", "habit_reminder", "goal_deadline"]) {
      assertEquals(k.filter((x) => x === kind).length, 1, kind);
    }
    // Logged habit → no nudge next day
    const next = "2026-11-16";
    await asUser(sql, uid, (tx) => tx`select log_habit(${hb.id}, ${next}::date, 1)`);
    await tick(new Date(`${next}T20:05:00+05:00`));
    assertEquals((await kinds()).filter((x) => x === "habit_reminder").length, 1);
  });

  await t.step("security: RLS isolation, ownership guards, column grants, internal functions", async () => {
    await pinClock(sql, T0);
    const a = await freshUser();
    const b = await freshUser();
    const ta = await newTask(a, { title: "A's secret", scheduled_at: T0 });
    const [ga] = await asUser(sql, a, (tx) => tx`insert into goals ${tx({ title: "A goal", period: "weekly",
      start_date: "2026-11-09", due_date: "2026-11-15" })} returning id`);

    assertEquals((await asUser(sql, b, (tx) => tx`select * from tasks where id = ${ta.id}`)).length, 0, "B can't read A");
    assertEquals((await asUser(sql, b, (tx) => tx`update tasks set title = 'pwned' where id = ${ta.id} returning id`)).length, 0);
    assertEquals((await asUser(sql, b, (tx) => tx`delete from tasks where id = ${ta.id} returning id`)).length, 0);
    assertEquals((await task(ta.id)).title, "A's secret");
    await assertRejects(() => asUser(sql, b, (tx) => tx`insert into tasks (title, goal_id) values ('x', ${ga.id})`), Error, "invalid_reference");
    await assertRejects(() => asUser(sql, b, (tx) => tx`insert into tasks (user_id, title) values (${a}, 'x')`), Error, "row-level security");
    await assertRejects(() => asUser(sql, b, (tx) => tx`select task_action(${ta.id}, 'complete')`), Error, "task_not_found");
    await assertRejects(() => asUser(sql, a, (tx) => tx`update tasks set next_reminder_at = null where id = ${ta.id}`), Error, "permission denied");
    await assertRejects(() => asUser(sql, a, (tx) => tx`insert into notifications (user_id, kind, title, dedupe_key) values (${a}, 'system', 'x', 'x')`), Error, "permission denied");
    await assertRejects(() => asUser(sql, a, (tx) => tx`select run_scheduler_tick()`), Error, "permission denied");
    await assertRejects(() => asUser(sql, a, (tx) => tx`select * from lease_notifications()`), Error, "permission denied");
    await assertRejects(() => asUser(sql, a, (tx) => tx`select apply_task_action(${ta.id}, ${a}, 'complete')`), Error, "permission denied");
    await assertRejects(() => asAnon(sql, (tx) => tx`select * from tasks`), Error, "permission denied");
    await assertRejects(() => asAnon(sql, (tx) => tx`select task_action(${ta.id}, 'complete')`), Error, "permission denied");

    // Push subscription registration + endpoint reassignment
    const ep = "https://push.example.com/send/abc123";
    const key = "B".repeat(87);
    await asUser(sql, a, (tx) => tx`select register_push_subscription(${ep}, ${key}, 'authsecret123', 'UA')`);
    assertEquals((await asUser(sql, a, (tx) => tx`select * from push_subscriptions`)).length, 1);
    assertEquals((await asUser(sql, b, (tx) => tx`select * from push_subscriptions`)).length, 0);
    await asUser(sql, b, (tx) => tx`select register_push_subscription(${ep}, ${key}, 'authsecret123', 'UA')`);
    assertEquals((await asUser(sql, a, (tx) => tx`select * from push_subscriptions`)).length, 0, "endpoint moved to B");

    // Notifications: user may only mark read
    await asUser(sql, a, (tx) => tx`select send_test_notification()`);
    assertEquals((await asUser(sql, a, (tx) => tx`select mark_notifications_read()`))[0].mark_notifications_read, 1);
    await assertRejects(() => asUser(sql, a, (tx) => tx`update notifications set status = 'sent'`), Error, "permission denied");
  });
});

Deno.test({ name: "pg_cron: jobs registered and the tick actually runs", sanitizeResources: false, sanitizeOps: false }, async () => {
  await sql`update cron.job set active = true`;
  const jobs = await sql`select jobname, schedule from cron.job order by jobname`;
  assertEquals(jobs.map((j) => j.jobname), ["cadence-cleanup", "cadence-dispatch", "cadence-scheduler-tick"]);

  // Dispatch job → pg_net request with URL + bearer secret from Vault.
  await sql`insert into vault.decrypted_secrets values ('cadence_project_url', 'https://abc.supabase.co'), ('cadence_cron_secret', 's3cret')
            on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`;
  const [{ command }] = await sql`select command from cron.job where jobname = 'cadence-dispatch'`;
  await sql.unsafe(command);
  const [req] = await sql`select * from net.requests order by id desc limit 1`;
  assertEquals(req.url, "https://abc.supabase.co/functions/v1/dispatch-reminders");
  assertEquals(req.headers.Authorization, "Bearer s3cret");

  // Wait for pg_cron's real background worker to run the SQL tick.
  const deadline = Date.now() + 75_000;
  let ok = false;
  while (Date.now() < deadline && !ok) {
    const [r] = await sql`select count(*)::int n from cron.job_run_details d join cron.job j using (jobid)
                          where j.jobname = 'cadence-scheduler-tick' and d.status = 'succeeded'`;
    ok = r.n > 0;
    if (!ok) await new Promise((r) => setTimeout(r, 2000));
  }
  assert(ok, "pg_cron executed run_scheduler_tick successfully");
  await sql.end();
});
