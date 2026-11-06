// Notification action tokens: "<notification uuid>.<base64url HMAC-SHA256(secret, uuid)>".
// Stateless and stable across delivery retries; the server additionally checks the
// notification exists, belongs to a task and is younger than TOKEN_MAX_AGE_DAYS.
import { timingSafeEqual } from "./http.ts";

export const TOKEN_MAX_AGE_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`cadence-action:v1:${data}`)));
}

export async function signActionToken(secret: string, notificationId: string): Promise<string> {
  return `${notificationId}.${await hmac(secret, notificationId)}`;
}

/** Returns the notification id if the token is authentic, otherwise null. */
export async function verifyActionToken(secret: string, token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length > 200) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !UUID_RE.test(id)) return null;
  const expected = await hmac(secret, id);
  return timingSafeEqual(expected, sig) ? id.toLowerCase() : null;
}
