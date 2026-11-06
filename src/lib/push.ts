"use client";
// Browser side of Web Push: service-worker registration, permission, subscription,
// and keeping the server's copy of the subscription in sync.
import { supabase } from "./supabase/client";

export type PushState =
  | "loading"
  | "unsupported"        // no SW / PushManager / Notification API
  | "insecure"           // not served over HTTPS (or localhost)
  | "ios-install"        // iOS Safari: must be added to Home Screen first (iOS 16.4+)
  | "denied"             // user blocked notifications for this site
  | "default"            // never asked
  | "granted"            // permission granted but this device isn't subscribed
  | "subscribed";

const ENABLED_FLAG = "cadence.push.enabled";

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    return reg;
  } catch (e) {
    console.warn("[push] service worker registration failed", e);
    return null;
  }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await registerServiceWorker();
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "loading";
  if (!window.isSecureContext) return "insecure";
  if (isIOS() && !isStandalone() && !pushSupported()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  const reg = await readyRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "granted";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : isIOS() ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${os}${isStandalone() ? " (app)" : ""}`;
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await supabase().rpc("register_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
    p_device_label: deviceLabel(),
  });
  if (error) throw new Error(error.message);
}

/** Must be called from a user gesture (click). */
export async function enablePush(): Promise<PushState> {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured");
  if (!pushSupported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";

  const reg = await readyRegistration();
  if (!reg) throw new Error("Service worker unavailable");
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(vapid);
  // Re-subscribe if the server key changed (e.g. rotated VAPID keys).
  if (sub && sub.options.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    if (current.length !== key.length || current.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(sub);
  localStorage.setItem(ENABLED_FLAG, "1");
  return "subscribed";
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(ENABLED_FLAG);
  const reg = await navigator.serviceWorker?.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase().rpc("unregister_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

/**
 * On every app start: make sure the server has this device's current subscription.
 * Covers rotated endpoints (pushsubscriptionchange), account switches on a shared
 * browser, and subscriptions the server disabled after a 404/410.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const reg = await readyRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && localStorage.getItem(ENABLED_FLAG) && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) });
    }
    if (sub) await saveSubscription(sub);
  } catch (e) {
    console.warn("[push] sync failed", e);
  }
}

export async function sendTestNotification() {
  const { error } = await supabase().rpc("send_test_notification");
  if (error) throw new Error(error.message);
}
