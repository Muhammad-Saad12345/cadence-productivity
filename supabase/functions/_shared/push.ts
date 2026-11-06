import webpush from "web-push";
import { env } from "./env.ts";

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  subscriptionId: string;
  ok: boolean;
  statusCode: number | null;
  /** Subscription is permanently invalid (404/410) and must be disabled. */
  gone: boolean;
  /** Worth retrying later (429, 5xx, network error). */
  retryable: boolean;
  error?: string;
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  configured = true;
}

export async function sendPush(
  target: PushTarget,
  payload: unknown,
  opts: { ttlSeconds: number; urgency: "very-low" | "low" | "normal" | "high"; topic?: string; timeoutMs?: number },
): Promise<PushResult> {
  configure();
  try {
    const res = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: opts.ttlSeconds, urgency: opts.urgency, topic: opts.topic, timeout: opts.timeoutMs ?? 10_000 },
    );
    return { subscriptionId: target.id, ok: true, statusCode: res.statusCode, gone: false, retryable: false };
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const err = e as any;
    const status: number | null = typeof err?.statusCode === "number" ? err.statusCode : null;
    const gone = status === 404 || status === 410;
    const retryable = status === null || status === 429 || status >= 500;
    const detail = typeof err?.body === "string" && err.body ? `: ${err.body.slice(0, 200)}` : "";
    return {
      subscriptionId: target.id,
      ok: false,
      statusCode: status,
      gone,
      retryable,
      error: `${err?.message ?? String(e)}${detail}`.slice(0, 500),
    };
  }
}

/** Push "Topic" header: ≤32 URL-safe chars. Same topic ⇒ push service replaces undelivered message. */
export function topicFor(id: string): string {
  return id.replace(/-/g, "").slice(0, 32);
}
