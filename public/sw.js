/* Cadence service worker
 * - Shows Web Push notifications (works with every tab closed)
 * - Handles Complete / Pending / Cancel buttons without opening the app
 * - Falls back to the /n action screen where buttons aren't supported
 * - Queues actions taken while offline and replays them (Background Sync / next push / next app open)
 * - Offline fallback page for navigations
 */
const VERSION = "cadence-sw-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
const TASK_ACTIONS = ["complete", "pending", "cancel"];

// ------------------------------------------------------------------ lifecycle
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
    await flushQueue().catch(() => {});
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "flush-queue") event.waitUntil(flushQueue().catch(() => {}));
});

// ------------------------------------------------------------------ fetch: offline fallback
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }
  // Immutable build assets & icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});

// ------------------------------------------------------------------ push
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data;
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { title: "Cadence", body: event.data ? event.data.text() : "" };
    }
    await flushQueue().catch(() => {});

    const isTask = data.kind === "task_reminder" && data.token && Array.isArray(data.actions) && data.actions.length > 0;
    const max = (self.Notification && self.Notification.maxActions) || 0;
    let actions = [];
    if (isTask) {
      if (max >= 3) {
        actions = [
          { action: "complete", title: "✓ Complete" },
          { action: "pending", title: "Pending" },
          { action: "cancel", title: "Cancel" },
        ];
      } else if (max === 2) {
        // Chrome desktop shows two buttons: Complete + a link to every other option.
        actions = [
          { action: "complete", title: "✓ Complete" },
          { action: "more", title: "More options…" },
        ];
      } else if (max === 1) {
        actions = [{ action: "complete", title: "✓ Complete" }];
      }
      // max === 0 (Firefox, Safari): clicking the notification opens the action screen.
    }

    const options = {
      body: data.body || "",
      tag: data.tag || data.id || "cadence",
      renotify: true,
      requireInteraction: !!data.requireInteraction,
      silent: !!data.silent,
      timestamp: data.timestamp || Date.now(),
      icon: ICON,
      badge: BADGE,
      data,
      actions,
    };
    if (data.vibrate && !data.silent) options.vibrate = [120, 60, 120];

    await self.registration.showNotification(data.title || "Cadence", options);
    await broadcast({ type: "push", payload: { id: data.id, kind: data.kind, taskId: data.taskId } });
  })());
});

// ------------------------------------------------------------------ clicks
self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;
  notification.close();

  event.waitUntil((async () => {
    if (data.kind === "confirmation" || data.kind === "info") {
      return openUrl(data.url || "/dashboard");
    }
    if (data.kind === "task_reminder" && data.token) {
      if (TASK_ACTIONS.includes(action)) return performAction(data, action);
      // Body click, "More options…", or platforms without action buttons.
      return openUrl(`/n#t=${encodeURIComponent(data.token)}`);
    }
    return openUrl(data.url || "/dashboard");
  })());
});

// ------------------------------------------------------------------ actions
async function postAction(actionUrl, token, action, minutes) {
  const res = await fetch(actionUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action, minutes }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, body };
}

async function performAction(data, action) {
  try {
    const r = await postAction(data.actionUrl, data.token, action);
    if (r.ok) {
      await broadcast({ type: "task-updated", taskId: data.taskId, action });
      return confirmation(data, action, r.body && r.body.task);
    }
    if (r.status === 409) {
      const status = r.body && r.body.task && r.body.task.status;
      return info(data, `This task is already ${status || "closed"}.`);
    }
    if (r.status === 401) {
      return info(data, "This reminder link has expired. Open Cadence to update the task.", "/tasks");
    }
    if (r.status >= 500) throw new Error(`server ${r.status}`);
    return info(data, "Couldn't update the task. Open Cadence to try again.", "/tasks");
  } catch {
    // Offline or server unreachable: queue and retry later.
    await queueAction({ actionUrl: data.actionUrl, token: data.token, action, taskId: data.taskId, title: data.title, at: Date.now() });
    try {
      if (self.registration.sync) await self.registration.sync.register("cadence-actions");
    } catch {
      /* Background Sync unsupported (Firefox/Safari): replayed on next push or app open */
    }
    return info(data, `You're offline — “${labelFor(action)}” saved and will sync automatically.`);
  }
}

function labelFor(action) {
  return action === "complete" ? "Complete" : action === "cancel" ? "Cancel" : "Pending";
}

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

async function confirmation(data, action, task) {
  const body =
    action === "complete" ? "Marked complete. Nice work."
    : action === "cancel" ? "Task cancelled. Reminders stopped."
    : task && task.next_reminder_at ? `Kept pending. Next reminder at ${fmtTime(task.next_reminder_at)}.`
    : "Kept pending.";
  await showTransient(data, body, `/tasks?task=${data.taskId}`);
}

async function info(data, body, url) {
  await showTransient(data, body, url || `/tasks?task=${data.taskId}`, "info");
}

/** Brief confirmation that replaces the reminder (same tag) and closes itself. */
async function showTransient(data, body, url, kind = "confirmation") {
  const tag = data.tag || "cadence";
  await self.registration.showNotification(data.title || "Cadence", {
    body, tag, renotify: false, silent: true, icon: ICON, badge: BADGE, data: { kind, url },
  });
  await new Promise((r) => setTimeout(r, 4000));
  const open = await self.registration.getNotifications({ tag });
  open.forEach((n) => n.data && n.data.kind === kind && n.close());
}

async function openUrl(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin && "focus" in client) {
      await client.focus();
      try {
        if ("navigate" in client) return await client.navigate(url);
      } catch {
        /* uncontrolled client: fall through to postMessage */
      }
      client.postMessage({ type: "navigate", url: path });
      return;
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(url);
}

async function broadcast(msg) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  windows.forEach((c) => c.postMessage(msg));
}

// ------------------------------------------------------------------ offline action queue (IndexedDB)
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("cadence-sw", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("actions", { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("actions", mode);
    const store = t.objectStore("actions");
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}
const queueAction = (item) => tx("readwrite", (s) => s.add(item));
const queued = () => tx("readonly", (s) => s.getAll());
const unqueue = (id) => tx("readwrite", (s) => s.delete(id));

let flushing = null;
async function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    const items = await queued();
    for (const item of items) {
      try {
        const r = await postAction(item.actionUrl, item.token, item.action);
        // Done, already closed, or permanently invalid → drop. 5xx → keep for later.
        if (r.ok || (r.status >= 400 && r.status < 500)) {
          await unqueue(item.id);
          if (r.ok) await broadcast({ type: "task-updated", taskId: item.taskId, action: item.action });
        } else break;
      } catch {
        break; // still offline
      }
    }
  })().finally(() => (flushing = null));
  return flushing;
}

self.addEventListener("sync", (event) => {
  if (event.tag === "cadence-actions") event.waitUntil(flushQueue());
});

// ------------------------------------------------------------------ subscription rotation
self.addEventListener("pushsubscriptionchange", (event) => {
  // Re-subscribe with the same server key; the app re-registers the new endpoint with the
  // backend the next time it opens (syncPushSubscription). The old endpoint will 410 and be disabled.
  event.waitUntil((async () => {
    const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
    if (key) {
      try {
        await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch {
        /* user will be prompted in-app */
      }
    }
    await broadcast({ type: "subscription-changed" });
  })());
});
