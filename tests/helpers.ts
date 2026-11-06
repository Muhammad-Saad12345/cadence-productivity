// Shared test utilities: DB access as Supabase roles, a pinned clock,
// and a mock Web Push service that really decrypts RFC 8291 payloads
// and verifies RFC 8292 VAPID signatures.
import postgres from "npm:postgres@3.4.7";

export const DB_URL = Deno.env.get("TEST_DB_URL") ?? "postgres://postgres@127.0.0.1:54322/cadence";

export function connect(max = 1) {
  return postgres(DB_URL, { max, prepare: false, onnotice: () => {} });
}
export type Sql = ReturnType<typeof connect>;

export async function createUser(sql: Sql, email: string, tz = "Asia/Karachi"): Promise<string> {
  const [u] = await sql`insert into auth.users (email, raw_user_meta_data)
                        values (${email}, ${sql.json({ timezone: tz, full_name: email.split("@")[0] })})
                        returning id`;
  return u.id;
}

/** Run fn inside a transaction as the Supabase `authenticated` role with the given user's JWT claims. */
export async function asUser<T>(sql: Sql, uid: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
    return await fn(tx as unknown as Sql);
  }) as T;
}

export async function asAnon<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx.unsafe("set local role anon");
    return await fn(tx as unknown as Sql);
  }) as T;
}

/** Pin the scheduler clock for this connection (session-level). */
export async function pinClock(sql: Sql, at: Date | string | null) {
  await sql`select set_config('cadence.now', ${at === null ? "" : new Date(at).toISOString()}, false)`;
}

export const addMin = (d: Date | string, m: number) => new Date(new Date(d).getTime() + m * 60_000);

// ---------------------------------------------------------------------------
// Web Push crypto helpers
// ---------------------------------------------------------------------------
export const b64u = (u: Uint8Array) =>
  btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export interface Subscriber {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  auth: Uint8Array;
  p256dh: string;
  authB64: string;
}

export async function newSubscriber(): Promise<Subscriber> {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: kp.privateKey, publicRaw, auth, p256dh: b64u(publicRaw), authB64: b64u(auth) };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

/** RFC 8291 aes128gcm decryption, as a browser would do it. */
export async function decryptPush(sub: Subscriber, body: Uint8Array): Promise<unknown> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, sub.privateKey, 256));
  const ikm = await hkdf(sub.auth, ecdh, cat(enc("WebPush: info\0"), sub.publicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("bad padding delimiter");
  return JSON.parse(new TextDecoder().decode(padded.slice(0, end)));
}

/** RFC 8292: verify `Authorization: vapid t=<jwt>, k=<key>` (ES256, aud = push origin). */
export async function verifyVapid(header: string, expectedAud: string, expectedKey: string) {
  const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(header);
  if (!m) throw new Error(`not a vapid header: ${header}`);
  const [jwt, k] = [m[1], m[2]];
  if (k !== expectedKey) throw new Error("vapid key mismatch");
  const [h, p, s] = jwt.split(".");
  const pub = await crypto.subtle.importKey("raw", unb64u(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(s), enc(`${h}.${p}`));
  if (!ok) throw new Error("vapid signature invalid");
  const claims = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (claims.aud !== expectedAud) throw new Error(`aud ${claims.aud} != ${expectedAud}`);
  if (claims.exp * 1000 < Date.now()) throw new Error("vapid jwt expired");
  return claims;
}

// ---------------------------------------------------------------------------
// Mock push service (HTTPS, like FCM / Mozilla autopush)
// ---------------------------------------------------------------------------
export interface ReceivedPush {
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
  at: number;
}

export function startMockPushService(certFile = "/tmp/mockpush.crt", keyFile = "/tmp/mockpush.key") {
  const received: ReceivedPush[] = [];
  /** path → status code to answer with (default 201) */
  const behaviour = new Map<string, number>();
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", cert: Deno.readTextFileSync(certFile), key: Deno.readTextFileSync(keyFile), onListen() {} },
    async (req) => {
      const url = new URL(req.url);
      const body = new Uint8Array(await req.arrayBuffer());
      received.push({ path: url.pathname, headers: Object.fromEntries(req.headers), body, at: Date.now() });
      const code = behaviour.get(url.pathname) ?? 201;
      return new Response(code >= 400 ? "push service error" : null, { status: code });
    },
  );
  const port = (server.addr as Deno.NetAddr).port;
  return {
    origin: `https://localhost:${port}`,
    endpoint: (name: string) => `https://localhost:${port}/push/${name}`,
    received,
    behaviour,
    for: (name: string) => received.filter((r) => r.path === `/push/${name}`),
    close: () => server.shutdown(),
  };
}

export function assertEq<T>(actual: T, expected: T, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}
