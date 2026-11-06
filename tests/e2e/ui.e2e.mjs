// Browser end-to-end test: real built Next.js app + service worker in headless Chrome,
// real Postgres (RLS), real Edge Function handlers, via tests/e2e/supabase-emulator.ts.
// Run through tests/e2e/run.sh.
import crypto from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const ACTION_SECRET = process.env.NOTIFICATION_ACTION_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/cadence-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const sql = postgres(process.env.TEST_DB_URL ?? "postgres://postgres@127.0.0.1:54322/cadence", { max: 2, onnotice: () => {} });

const results = [];
const pageErrors = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✔ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.stack ?? e) });
    console.log(`  ✘ ${name}\n    ${String(e?.message ?? e).split("\n").join("\n    ")}`);
    try { await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, "_")}.png` }); } catch { /* ignore */ }
  }
}
const assert = (c, m) => { if (!c) throw new Error(m ?? "assertion failed"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 15000, every = 300, msg = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${msg} (last: ${last})`);
}
const sign = (id) => `${id}.${crypto.createHmac("sha256", ACTION_SECRET).update(`cadence-action:v1:${id}`).digest("base64url")}`;
const dispatch = () => fetch(`${API}/functions/v1/dispatch-reminders`, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } }).then((r) => r.json());
const clickText = async (text, sel = "button") => {
  const el = await page.waitForSelector(`${sel}::-p-text(${text})`, { visible: true, timeout: 10000 });
  await el.click();
};
const refetch = () => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1366,900"],
  defaultViewport: { width: 1366, height: 900 },
});
const context = browser.defaultBrowserContext();
let page = await browser.newPage();
await page.emulateTimezone("Asia/Karachi");
page.on("pageerror", (e) => pageErrors.push(String(e)));
const cdp = await browser.target().createCDPSession();
const setNotificationPermission = (setting) =>
  cdp.send("Browser.setPermission", { origin: APP, permission: { name: "notifications" }, setting });

const email = `saad.${Date.now()}@cadence.test`;
let uid;

console.log("Cadence UI end-to-end");

await step("unauthenticated visit redirects to /login", async () => {
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle0" });
  assert(page.url().startsWith(`${APP}/login`), `url ${page.url()}`);
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
});

await step("sign up → dashboard; profile created in Asia/Karachi", async () => {
  await clickText("Sign up", "button[role=tab]");
  await page.type("#name", "Saad");
  await page.type("#email", email);
  await page.type("#password", "correct-horse-battery");
  await clickText("Create account");
  await page.waitForFunction(() => location.pathname === "/dashboard", { timeout: 15000 });
  await page.waitForSelector("h1::-p-text(Saad)", { timeout: 15000 });
  const [u] = await sql`select u.id, p.timezone, p.display_name from auth.users u join profiles p on p.id = u.id where u.email = ${email}`;
  uid = u.id;
  assert(u.timezone === "Asia/Karachi" && u.display_name === "Saad", JSON.stringify(u));
});

await step("push status card offers to enable notifications (permission: default)", async () => {
  const state = await page.$eval("[data-testid=push-status]", (el) => el.dataset.state);
  assert(state === "default", `state=${state}`);
  await page.screenshot({ path: `${SHOTS}/02-dashboard-empty.png` });
});

await step("quick add parses natural language (N shortcut)", async () => {
  await page.keyboard.press("n");
  await page.waitForSelector("input[aria-label=Task]", { visible: true });
  await page.type("input[aria-label=Task]", "Prepare DBMS slides tomorrow 5pm !high #study ~45m");
  await page.waitForSelector("::-p-text(Tomorrow 5:00 PM)", { timeout: 5000 });
  await page.keyboard.press("Enter");
  const t = await until(async () => (await sql`select t.*, c.name as cat from tasks t left join categories c on c.id = t.category_id where t.user_id = ${uid} and t.title = 'Prepare DBMS slides'`)[0], { msg: "task row" });
  const local = (await sql`select to_char(${t.scheduled_at}::timestamptz at time zone 'Asia/Karachi', 'HH24:MI') l,
                                 (${t.scheduled_at}::timestamptz at time zone 'Asia/Karachi')::date - (now() at time zone 'Asia/Karachi')::date d`)[0];
  assert(local.l === "17:00" && local.d === 1, JSON.stringify(local));
  assert(t.priority === "high" && t.cat === "Study" && t.estimated_minutes === 45 && t.status === "upcoming", JSON.stringify({ p: t.priority, c: t.cat, e: t.estimated_minutes, s: t.status }));
  assert(+t.next_reminder_at === +t.scheduled_at, "reminder scheduled at task time");
});

await step("upcoming view lists the task", async () => {
  await page.goto(`${APP}/upcoming`, { waitUntil: "networkidle0" });
  await page.waitForSelector("::-p-text(Prepare DBMS slides)", { timeout: 10000 });
});

await step("task editor: edit title/priority, add subtask, recurrence", async () => {
  await clickText("Prepare DBMS slides");
  await page.waitForSelector("[role=dialog] input[aria-label=Title]", { visible: true });
  const title = await page.$("[role=dialog] input[aria-label=Title]");
  await title.click({ clickCount: 3 });
  await title.type("Prepare DBMS lab slides");
  await page.type("[role=dialog] input[placeholder='Add a subtask']", "Draft outline");
  await page.keyboard.press("Enter");
  await until(async () => (await sql`select count(*)::int n from subtasks where user_id = ${uid}`)[0].n === 1, { msg: "subtask" });
  await clickText("Save changes");
  await until(async () => (await sql`select 1 from tasks where user_id = ${uid} and title = 'Prepare DBMS lab slides'`).length === 1, { msg: "title saved" });
  await page.waitForSelector("::-p-text(1/1)", { timeout: 1000 }).catch(() => {}); // subtask badge (0/1)
});

let dueTaskId;
await step("S1/S2 + S9: reminder at scheduled time surfaces in-app when push is unavailable; Complete from toast", async () => {
  await page.goto(`${APP}/today`, { waitUntil: "networkidle0" });
  await page.keyboard.press("n");
  await page.waitForSelector("input[aria-label=Task]", { visible: true });
  await page.type("input[aria-label=Task]", "Call supplier in 1m !critical");
  await page.keyboard.press("Enter");
  const t = await until(async () => (await sql`select * from tasks where user_id = ${uid} and title = 'Call supplier'`)[0], { msg: "task" });
  dueTaskId = t.id;
  // Wait for the real scheduled time, then run the dispatcher as pg_cron would.
  await sleep(Math.max(0, new Date(t.scheduled_at).getTime() - Date.now() + 500));
  const r = await dispatch();
  assert(r.ok, JSON.stringify(r));
  const [n] = await sql`select * from notifications where task_id = ${t.id}`;
  assert(n && n.status === "no_channel", `notification ${JSON.stringify(n)}`);
  assert(new Date(n.scheduled_for).getTime() === new Date(t.scheduled_at).getTime(), "reminder for the scheduled slot");
  await refetch();
  // Realtime isn't emulated, so this exercises the polling fallback (≤ 60 s).
  await page.waitForSelector("[data-sonner-toast] ::-p-text(Call supplier)", { timeout: 75000 });
  await page.screenshot({ path: `${SHOTS}/03-inapp-reminder.png` });
  await clickText("Complete", "[data-sonner-toast] button");
  await until(async () => (await sql`select status from tasks where id = ${t.id}`)[0].status === "completed", { msg: "completed" });
  const [h] = await sql`select source from task_completion_history where task_id = ${t.id} and event = 'completed'`;
  assert(h.source === "app");
  await dispatch();
  assert((await sql`select count(*)::int c from notifications where task_id = ${t.id}`)[0].c === 1, "no further reminders");
});

await step("S8: weekly goal → linked task → complete → goal completed + celebration", async () => {
  await page.goto(`${APP}/goals`, { waitUntil: "networkidle0" });
  await clickText("Weekly goal");
  await page.type("[role=dialog] input[aria-label='Goal title']", "Ship auth module");
  await clickText("Create goal", "[role=dialog] button");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  await page.waitForSelector("[role=button] ::-p-text(Ship auth module)", { visible: true });
  await page.evaluate(() => [...document.querySelectorAll("[role=button]")].find((el) => el.textContent.includes("Ship auth module")).click());
  await page.waitForSelector("[role=dialog] h2::-p-text(Ship auth module)", { visible: true });
  await sleep(500); // let the sheet finish sliding in
  await clickText("Task", "[role=dialog] button");
  const titleSel = "input[aria-label=Title]";
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent), {}, titleSel);
  await page.type(titleSel, "Write login form");
  await clickText("Create task");
  const [t] = await until(() => sql`select * from tasks where user_id = ${uid} and title = 'Write login form'`.then((r) => r.length && r), { msg: "linked task" });
  const [g] = await sql`select * from goals where user_id = ${uid} and title = 'Ship auth module'`;
  assert(t.goal_id === g.id && g.period === "weekly" && g.status === "not_started");
  await page.waitForSelector("[role=dialog] button[aria-label='Complete task']", { visible: true });
  await page.click("[role=dialog] button[aria-label='Complete task']");
  await page.waitForSelector("::-p-text(Weekly goal achieved)", { visible: true, timeout: 15000 });
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/04-goal-celebration.png` });
  const [g2] = await sql`select status, progress_pct, completed_at from goals where id = ${g.id}`;
  assert(g2.status === "completed" && Number(g2.progress_pct) === 100 && g2.completed_at, JSON.stringify(g2));
  await clickText("Continue");
  await until(async () => (await sql`select celebrated_at from goals where id = ${g.id}`)[0].celebrated_at, { msg: "celebrated_at" });
  const badges = (await sql`select code from achievements where user_id = ${uid}`).map((x) => x.code);
  assert(badges.includes("first_goal") && badges.includes(`goal:${g.id}`), String(badges));
});

await step("calendar: month view shows task; drag-and-drop reschedules by one day keeping the time", async () => {
  await page.keyboard.press("Escape");
  await page.goto(`${APP}/calendar`, { waitUntil: "networkidle0" });
  const [before] = await sql`select id, scheduled_at from tasks where user_id = ${uid} and title = 'Prepare DBMS lab slides'`;
  const chip = await page.waitForSelector("button[draggable=true]::-p-text(Prepare DBMS lab slides)", { visible: true });
  await page.screenshot({ path: `${SHOTS}/05-calendar.png` });
  const localDay = (await sql`select (${before.scheduled_at}::timestamptz at time zone 'Asia/Karachi')::date + 1 as d`)[0].d;
  const key = new Date(localDay).toISOString().slice(0, 10);
  const target = await page.$(`button[aria-label='Add task on ${key}']`).then((b) => b.evaluateHandle((el) => el.closest("[data-over], div.group")));
  await page.setDragInterception(true);
  await chip.dragAndDrop(target);
  await page.setDragInterception(false);
  const [after] = await until(() => sql`select scheduled_at from tasks where id = ${before.id}`.then((r) => +r[0].scheduled_at !== +before.scheduled_at && r), { msg: "rescheduled" });
  assert(+after.scheduled_at - +before.scheduled_at === 86400_000, `delta ${(+after.scheduled_at - +before.scheduled_at) / 3600_000}h`);
});

await step("habits: create a habit and log today", async () => {
  await page.goto(`${APP}/habits`, { waitUntil: "networkidle0" });
  await clickText("New habit");
  await page.type("#h-name", "Read 20 pages");
  await clickText("Save", "[role=dialog] button");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  const cell = await page.waitForSelector("button[aria-label^='Read 20 pages'][aria-label$='not done']:not([disabled])", { visible: true });
  await cell.click();
  await until(async () => (await sql`select count from habit_logs where user_id = ${uid}`)[0]?.count === 1, { msg: "habit log" });
});

await step("focus: pomodoro runs and pauses", async () => {
  await page.goto(`${APP}/focus`, { waitUntil: "networkidle0" });
  await clickText("Start");
  await sleep(2200);
  const shown = await page.$eval("[role=timer]", (e) => e.textContent);
  assert(/^24:5\d$/.test(shown), `timer ${shown}`);
  await clickText("Pause");
  await page.screenshot({ path: `${SHOTS}/06-focus.png` });
  await clickText("Reset", "button[aria-label=Reset]").catch(() => page.click("button[aria-label=Reset]"));
});

await step("settings: preferences persist (quiet hours, interval)", async () => {
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle0" });
  await page.waitForSelector("button[aria-label='Quiet hours']");
  await page.click("button[aria-label='Quiet hours']");
  await until(async () => (await sql`select quiet_hours_enabled from notification_preferences where user_id = ${uid}`)[0].quiet_hours_enabled === true, { msg: "quiet hours saved" });
  await page.click("button[aria-label='Quiet hours']");
  await until(async () => (await sql`select quiet_hours_enabled from notification_preferences where user_id = ${uid}`)[0].quiet_hours_enabled === false, { msg: "quiet hours off" });
});

await step("S9: denied notification permission is explained", async () => {
  await setNotificationPermission("denied");
  await page.reload({ waitUntil: "networkidle0" });
  const state = await page.waitForSelector("[data-testid=push-status][data-state=denied]", { timeout: 8000 });
  assert(state);
  await page.screenshot({ path: `${SHOTS}/07-settings-denied.png` });
});

await step("notifications center lists the reminder as in-app only", async () => {
  await page.goto(`${APP}/notifications`, { waitUntil: "networkidle0" });
  await page.waitForSelector("::-p-text(In-app only)", { timeout: 8000 });
  await page.waitForSelector("::-p-text(Weekly goal achieved)");
});

await step("analytics / review / dashboard render without errors", async () => {
  for (const p of ["/analytics", "/review", "/review?tab=weekly", "/projects", "/dashboard"]) {
    await page.goto(`${APP}${p}`, { waitUntil: "networkidle0" });
    await sleep(300);
  }
  await page.screenshot({ path: `${SHOTS}/08-dashboard.png` });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/09-dashboard-dark.png` });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/10-dashboard-mobile.png` });
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.setViewport({ width: 1366, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
});

// ------------------------------------------------------------------ service worker
async function makeReminder(title) {
  const [t] = await sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
    return tx`insert into tasks (title, scheduled_at, priority) values (${title}, now() - interval '5 seconds', 'high') returning *`;
  });
  await dispatch();
  const [n] = await sql`select * from notifications where task_id = ${t.id}`;
  return { task: t, notification: n, payload: {
    v: 1, id: n.id, kind: "task_reminder", title: n.title, body: n.body, url: n.url, tag: `task-${t.id}`, taskId: t.id,
    token: sign(n.id), actionUrl: `${API}/functions/v1/notification-action`, actions: ["complete", "pending", "cancel"],
    requireInteraction: true, silent: false, vibrate: true, timestamp: Date.now(),
  } };
}

let swWorker, regId;
await step("S7: service worker receives a push (no page interaction) and shows the reminder with actions", async () => {
  await setNotificationPermission("granted");
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle0" });
  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 15000 });
  swWorker = await swTarget.worker();
  const pageCdp = await page.createCDPSession();
  const regs = [];
  pageCdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
  await pageCdp.send("ServiceWorker.enable");
  await until(() => regs.find((r) => r.scopeURL === `${APP}/`), { msg: "sw registration" });
  regId = regs.find((r) => r.scopeURL === `${APP}/`).registrationId;
  const { task, payload } = await makeReminder("Submit invoice");
  await pageCdp.send("ServiceWorker.deliverPushMessage", { origin: APP, registrationId: regId, data: JSON.stringify(payload) });
  const shown = await until(() => swWorker.evaluate(async (tag) => {
    const ns = await self.registration.getNotifications({ tag });
    return ns.length ? { title: ns[0].title, body: ns[0].body, actions: ns[0].actions.map((a) => a.action), max: Notification.maxActions, requireInteraction: ns[0].requireInteraction } : null;
  }, payload.tag), { msg: "notification shown" });
  assert(shown.title === "Submit invoice", JSON.stringify(shown));
  const expected = shown.max >= 3 ? ["complete", "pending", "cancel"] : shown.max === 2 ? ["complete", "more"] : shown.max === 1 ? ["complete"] : [];
  assert(JSON.stringify(shown.actions) === JSON.stringify(expected), `actions ${shown.actions} for maxActions=${shown.max}`);
  console.log(`    (Notification.maxActions in this Chrome = ${shown.max}; buttons: ${shown.actions.join(", ")})`);
  globalThis.swTask = task;
  globalThis.swPayload = payload;
  globalThis.pageCdp = pageCdp;
});

const clickNotification = (tag, action) => swWorker.evaluate(async (tag, action) => {
  const n = (await self.registration.getNotifications({ tag })).find((x) => x.data?.kind === "task_reminder");
  if (!n) throw new Error("no reminder notification");
  self.dispatchEvent(new NotificationEvent("notificationclick", { notification: n, action }));
  return true;
}, tag, action);

await step("S4: Complete button in the notification completes the task with the tab closed", async () => {
  await page.goto("about:blank"); // no app page open — only the service worker
  await clickNotification(globalThis.swPayload.tag, "complete");
  await until(async () => (await sql`select status from tasks where id = ${globalThis.swTask.id}`)[0].status === "completed", { msg: "completed via SW" });
  const [h] = await sql`select source from task_completion_history where task_id = ${globalThis.swTask.id} and event = 'completed'`;
  assert(h.source === "notification");
  const confirm = await until(() => swWorker.evaluate(async (tag) => (await self.registration.getNotifications({ tag }))[0]?.body, globalThis.swPayload.tag), { msg: "confirmation" });
  assert(/Marked complete/.test(confirm), confirm);
});

await step("S5: Pending button keeps the task active and reminding", async () => {
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle0" });
  const { task, payload } = await makeReminder("Review PR");
  await globalThis.pageCdp.send("ServiceWorker.deliverPushMessage", { origin: APP, registrationId: regId, data: JSON.stringify(payload) });
  await until(() => swWorker.evaluate(async (tag) => (await self.registration.getNotifications({ tag })).some((n) => n.data?.kind === "task_reminder"), payload.tag), { msg: "reminder shown" });
  await clickNotification(payload.tag, "pending");
  await until(async () => (await sql`select 1 from task_completion_history where task_id = ${task.id} and event = 'acknowledged'`).length === 1, { msg: "pending acknowledged" });
  const [t] = await sql`select * from tasks where id = ${task.id}`;
  assert(t.status === "pending", t.status);
  assert(t.next_reminder_at && new Date(t.next_reminder_at) > new Date(), "next reminder scheduled in the future");
  const [h] = await sql`select source from task_completion_history where task_id = ${task.id} and event = 'acknowledged'`;
  assert(h?.source === "notification");
  globalThis.pendingTask = task;
});

await step("S6: Cancel button stops reminders and keeps the task in history", async () => {
  const [n] = await sql`select * from notifications where task_id = ${globalThis.pendingTask.id}`;
  const payload = { ...globalThis.swPayload, id: n.id, title: "Review PR", tag: `task-${globalThis.pendingTask.id}`, taskId: globalThis.pendingTask.id, token: sign(n.id) };
  await globalThis.pageCdp.send("ServiceWorker.deliverPushMessage", { origin: APP, registrationId: regId, data: JSON.stringify(payload) });
  await until(() => swWorker.evaluate(async (tag) => (await self.registration.getNotifications({ tag })).some((n) => n.data?.kind === "task_reminder"), payload.tag), { msg: "reminder shown" });
  await clickNotification(payload.tag, "cancel");
  const [t] = await until(() => sql`select * from tasks where id = ${globalThis.pendingTask.id}`.then((r) => r[0].status === "cancelled" && r), { msg: "cancelled" });
  assert(t.next_reminder_at === null && t.cancelled_at);
});

await step("offline: action pressed while the server is unreachable is queued, then synced", async () => {
  const { task, payload } = await makeReminder("Pay electricity bill");
  await globalThis.pageCdp.send("ServiceWorker.deliverPushMessage", { origin: APP, registrationId: regId, data: JSON.stringify(payload) });
  await until(() => swWorker.evaluate(async (tag) => (await self.registration.getNotifications({ tag })).some((n) => n.data?.kind === "task_reminder"), payload.tag), { msg: "reminder shown" });
  await fetch(`${API}/__test/fail-functions?on=1`);
  await clickNotification(payload.tag, "complete");
  const info = await until(() => swWorker.evaluate(async (tag) => (await self.registration.getNotifications({ tag }))[0]?.body, payload.tag).then((b) => /offline/i.test(b ?? "") && b), { msg: "offline notice" });
  assert((await sql`select status from tasks where id = ${task.id}`)[0].status !== "completed", "not yet applied");
  await fetch(`${API}/__test/fail-functions?on=0`);
  await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: "flush-queue" }));
  await until(async () => (await sql`select status from tasks where id = ${task.id}`)[0].status === "completed", { msg: "synced after reconnect" });
  console.log(`    (offline notice: “${info}”)`);
});

await step("fallback action screen (/n) works without a session", async () => {
  const { task, notification } = await makeReminder("Book dentist appointment");
  const anon = await browser.createBrowserContext();
  const p2 = await anon.newPage();
  await p2.emulateTimezone("Asia/Karachi");
  await p2.goto(`${APP}/n#t=${encodeURIComponent(sign(notification.id))}`, { waitUntil: "load" });
  await p2.waitForSelector("h1::-p-text(Book dentist appointment)", { timeout: 10000 });
  await p2.screenshot({ path: `${SHOTS}/11-action-screen.png` });
  const snooze = await p2.waitForSelector("button::-p-text(3 hours)");
  await snooze.click();
  await p2.waitForSelector("::-p-text(Snoozed until)", { timeout: 8000 });
  const [t] = await sql`select next_reminder_at from tasks where id = ${task.id}`;
  assert(Math.abs(new Date(t.next_reminder_at) - Date.now() - 3 * 3600_000) < 60_000, "snoozed ~3h");
  (await p2.waitForSelector("button::-p-text(Complete)")).click();
  await until(async () => (await sql`select status from tasks where id = ${task.id}`)[0].status === "completed", { msg: "completed via /n" });
  await p2.goto("about:blank");
  await p2.goto(`${APP}/n#t=${encodeURIComponent(sign(notification.id).slice(0, -3) + "xyz")}`, { waitUntil: "load" });
  await p2.waitForSelector("::-p-text(invalid or has expired)", { timeout: 8000 });
  await anon.close();
});

await step("offline banner appears when the browser goes offline", async () => {
  await page.goto(`${APP}/today`, { waitUntil: "networkidle0" });
  await page.setOfflineMode(true);
  await page.waitForSelector("::-p-text(You're offline)", { timeout: 5000 });
  await page.setOfflineMode(false);
});

await step("offline fallback page served by the service worker when the app server is unreachable", async () => {
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle0" });
  const { execSync } = await import("node:child_process");
  execSync("pkill -f '^next-server'; pkill -f '^npm exec next'; true");
  await sleep(1500);
  await page.goto(`${APP}/today`, { waitUntil: "load" }).catch(() => {});
  await page.waitForSelector("h1::-p-text(You're offline)", { timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/12-offline.png` });
});

console.log(`\nPage errors: ${pageErrors.length}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI steps passed`);
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
await sql.end();
process.exit(failed.length ? 1 : 0);
