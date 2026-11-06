// TEST-ONLY stand-in for the Supabase HTTP API, so the real Next.js app can be exercised
// end-to-end in a browser without Docker. It implements the subset of GoTrue (auth),
// PostgREST (rest) and Functions that Cadence uses, on top of the same local Postgres:
//   • every REST/RPC request runs as role `authenticated` (or `anon`) with
//     request.jwt.claims set — exactly how PostgREST applies RLS;
//   • /functions/v1/* are served by the REAL Edge Function handlers.
// It is NOT a full PostgREST implementation (no resource embedding, limited operators).
//
//   deno run -A tests/e2e/supabase-emulator.ts   (env: TEST_DB_URL, PORT, + function secrets)
import postgres from "npm:postgres@3.4.7";

const DB_URL = Deno.env.get("TEST_DB_URL") ?? "postgres://postgres@127.0.0.1:54322/cadence";
const PORT = Number(Deno.env.get("PORT") ?? 54321);
const JWT_SECRET = "emulator-jwt-secret-not-for-production";
Deno.env.set("SUPABASE_DB_URL", DB_URL);
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? `http://127.0.0.1:${PORT}`);

const { handle: dispatch } = await import("../../supabase/functions/dispatch-reminders/handler.ts");
const { handle: notificationAction } = await import("../../supabase/functions/notification-action/handler.ts");

// Return `date` columns as "YYYY-MM-DD" strings, exactly like PostgREST.
const sql = postgres(DB_URL, {
  max: 10, prepare: false, onnotice: () => {},
  types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
});
await sql`alter table auth.users add column if not exists encrypted_password text`;

// Test hooks
let failFunctions = false; // simulate the action endpoint being unreachable (offline queue test)

// ------------------------------------------------------------------ JWT (HS256)
const enc = new TextEncoder();
const b64u = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function signJwt(payload: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(s)}`;
}
async function verifyJwt(token: string | null): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!s) return null;
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${p}`)))) return null;
  const claims = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}
async function hashPw(pw: string) {
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`salt:${pw}`))));
}
async function session(user: { id: string; email: string; raw_user_meta_data: unknown; created_at: Date }) {
  const now = Math.floor(Date.now() / 1000);
  const access = await signJwt({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
  const u = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, user_metadata: user.raw_user_meta_data ?? {}, app_metadata: { provider: "email" }, created_at: user.created_at };
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `rt.${user.id}.${crypto.randomUUID()}`, user: u };
}

// ------------------------------------------------------------------ helpers
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-range, content-profile",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
const err = (message: string, status = 400, code = "PGRST000") => json({ message, code, details: null, hint: null }, status);

type Cols = Map<string, string>; // column → SQL type
const schema = new Map<string, Cols>();
for (const r of await sql`select table_name, column_name, format_type(a.atttypid, a.atttypmod) as type
                          from information_schema.columns c
                          join pg_attribute a on a.attrelid = ('public.' || c.table_name)::regclass and a.attname = c.column_name
                          where c.table_schema = 'public'`) {
  if (!schema.has(r.table_name)) schema.set(r.table_name, new Map());
  schema.get(r.table_name)!.set(r.column_name, r.type);
}

/** Split on commas at parenthesis depth 0. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

interface Built { text: string; params: unknown[] }
function filterExpr(table: string, col: string, opval: string, params: unknown[]): string {
  const cols = schema.get(table)!;
  const type = cols.get(col);
  if (!type) throw new Error(`unknown column ${col}`);
  const dot = opval.indexOf(".");
  let op = opval.slice(0, dot);
  let val = opval.slice(dot + 1);
  let not = false;
  if (op === "not") { not = true; const d = val.indexOf("."); op = val.slice(0, d); val = val.slice(d + 1); }
  const ident = `"${col}"`;
  let e: string;
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  switch (op) {
    case "eq": e = `${ident} = ${p(val)}::${type}`; break;
    case "neq": e = `${ident} <> ${p(val)}::${type}`; break;
    case "gt": e = `${ident} > ${p(val)}::${type}`; break;
    case "gte": e = `${ident} >= ${p(val)}::${type}`; break;
    case "lt": e = `${ident} < ${p(val)}::${type}`; break;
    case "lte": e = `${ident} <= ${p(val)}::${type}`; break;
    case "is": e = `${ident} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      e = `${ident} = any(${p(items)}::${type}[])`; break;
    }
    case "ilike": case "like": e = `${ident}::text ${op} ${p(decodeURIComponent(val).replace(/\*/g, "%"))}`; break;
    default: throw new Error(`unsupported operator ${op}`);
  }
  return not ? `not (${e})` : e;
}
function orExpr(table: string, inner: string, params: unknown[]): string {
  return "(" + splitTop(inner.replace(/^\(|\)$/g, "")).map((part) => {
    const d = part.indexOf(".");
    return filterExpr(table, part.slice(0, d), part.slice(d + 1), params);
  }).join(" or ") + ")";
}
function whereClause(table: string, url: URL, params: unknown[]): string {
  const parts: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    if (k === "or") parts.push(orExpr(table, v, params));
    else parts.push(filterExpr(table, k, v, params));
  }
  return parts.length ? `where ${parts.join(" and ")}` : "";
}
function selectList(table: string, url: URL): string {
  const s = url.searchParams.get("select") ?? "*";
  if (s === "*") return "*";
  const cols = schema.get(table)!;
  return s.split(",").map((c) => {
    const name = c.trim();
    if (!cols.has(name)) throw new Error(`unknown column ${name}`);
    return `"${name}"`;
  }).join(", ");
}
function orderClause(table: string, url: URL): string {
  const o = url.searchParams.get("order");
  if (!o) return "";
  const cols = schema.get(table)!;
  return "order by " + o.split(",").map((part) => {
    const [c, ...mods] = part.split(".");
    if (!cols.has(c)) throw new Error(`unknown column ${c}`);
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `"${c}" ${dir}${nulls}`;
  }).join(", ");
}
/** Typed value expression for a JSON value destined for table.col. */
function valueExpr(table: string, col: string, v: unknown, params: unknown[]) {
  params.push({ [col]: v }); // serialised as JSON by postgres.js
  return `(jsonb_populate_record(null::public.${table}, $${params.length}::jsonb))."${col}"`;
}

async function asRole<T>(claims: Record<string, unknown> | null, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return await sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${claims ? "authenticated" : "anon"}`);
    if (claims) await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return await fn(tx);
  });
}

// ------------------------------------------------------------------ handlers
async function rest(req: Request, url: URL, claims: Record<string, unknown> | null): Promise<Response> {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const prefer = req.headers.get("prefer") ?? "";
  const single = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
  const params: unknown[] = [];

  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    if (!/^[a-z_]+$/.test(fn)) return err("bad function", 404);
    const args = req.method === "POST" ? await req.json().catch(() => ({})) : Object.fromEntries(url.searchParams);
    const [meta] = await sql`select p.proretset, t.typtype, p.proargnames as names,
                                    array(select format_type(x, null) from unnest(p.proargtypes) x) as types
                             from pg_proc p join pg_type t on t.oid = p.prorettype
                             where p.proname = ${fn} and p.pronamespace = 'public'::regnamespace limit 1`;
    if (!meta) return err(`function ${fn} not found`, 404, "PGRST202");
    const argType = new Map<string, string>((meta.types as string[]).map((t, i) => [(meta.names as string[])[i], t]));
    const named = Object.entries(args).map(([k, v]) => {
      if (!argType.has(k)) throw new Error(`unknown argument ${k}`);
      const t = argType.get(k)!;
      params.push(v === null ? null : typeof v === "object" ? v : String(v));
      return `"${k}" => $${params.length}::${t}`;
    }).join(", ");
    const rows = await asRole(claims, (tx) =>
      meta.proretset || meta.typtype === "c"
        ? tx.unsafe(`select * from public.${fn}(${named})`, params as never[])
        : tx.unsafe(`select public.${fn}(${named}) as v`, params as never[]));
    if (meta.proretset || meta.typtype === "c") return json(rows);
    return json(rows[0]?.v ?? null);
  }

  const table = path;
  if (!schema.has(table)) return err(`relation ${table} does not exist`, 404, "42P01");
  const ret = prefer.includes("return=representation");
  const respond = (rows: unknown[], extra: Record<string, string> = {}) => {
    if (single) return rows.length === 1 ? json(rows[0], 200, extra) : err("JSON object requested, multiple (or no) rows returned", 406, "PGRST116");
    return json(rows, 200, extra);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    const where = whereClause(table, url, params);
    const limit = url.searchParams.get("limit") ? `limit ${Number(url.searchParams.get("limit"))}` : "";
    const offset = url.searchParams.get("offset") ? `offset ${Number(url.searchParams.get("offset"))}` : "";
    const q = `select ${selectList(table, url)} from public.${table} ${where} ${orderClause(table, url)} ${limit} ${offset}`;
    const rows = await asRole(claims, (tx) => tx.unsafe(q, params as never[]));
    const extra: Record<string, string> = {};
    if (prefer.includes("count=exact")) {
      const p2: unknown[] = [];
      const w2 = whereClause(table, url, p2);
      const [{ n }] = await asRole(claims, (tx) => tx.unsafe(`select count(*)::int n from public.${table} ${w2}`, p2 as never[]));
      extra["content-range"] = `${rows.length ? `0-${rows.length - 1}` : "*"}/${n}`;
    }
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...CORS, ...extra } });
    return respond(rows as unknown[], extra);
  }
  if (req.method === "POST") {
    const body = await req.json();
    const rowsIn: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
    const out: unknown[] = [];
    await asRole(claims, async (tx) => {
      for (const r of rowsIn) {
        const p: unknown[] = [];
        const cols = Object.keys(r).filter((c) => schema.get(table)!.has(c));
        const q = cols.length
          ? `insert into public.${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((c) => valueExpr(table, c, r[c], p)).join(", ")}) returning *`
          : `insert into public.${table} default values returning *`;
        out.push(...(await tx.unsafe(q, p as never[])));
      }
    });
    return ret ? respond(out) : new Response(null, { status: 201, headers: CORS });
  }
  if (req.method === "PATCH") {
    const body = await req.json();
    const cols = Object.keys(body).filter((c) => schema.get(table)!.has(c));
    const sets = cols.map((c) => `"${c}" = ${valueExpr(table, c, body[c], params)}`).join(", ");
    const where = whereClause(table, url, params);
    const rows = await asRole(claims, (tx) => tx.unsafe(`update public.${table} set ${sets} ${where} returning *`, params as never[]));
    return ret ? respond(rows as unknown[]) : new Response(null, { status: 204, headers: CORS });
  }
  if (req.method === "DELETE") {
    const where = whereClause(table, url, params);
    const rows = await asRole(claims, (tx) => tx.unsafe(`delete from public.${table} ${where} returning *`, params as never[]));
    return ret ? respond(rows as unknown[]) : new Response(null, { status: 204, headers: CORS });
  }
  return err("method not allowed", 405);
}

async function auth(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/.well-known/jwks.json") return json({ keys: [] });
  if (path === "/settings") return json({ external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
  if (path === "/signup" && req.method === "POST") {
    const { email, password, data } = await req.json();
    const [exists] = await sql`select 1 from auth.users where email = ${email}`;
    if (exists) return json({ code: 422, error_code: "user_already_exists", msg: "User already registered" }, 422);
    const [u] = await sql`insert into auth.users (email, raw_user_meta_data, encrypted_password)
                          values (${email}, ${sql.json(data ?? {})}, ${await hashPw(password)}) returning *`;
    return json(await session(u));
  }
  if (path === "/token") {
    const grant = url.searchParams.get("grant_type");
    const body = await req.json();
    if (grant === "password") {
      const [u] = await sql`select * from auth.users where email = ${body.email}`;
      if (!u || u.encrypted_password !== (await hashPw(body.password))) {
        return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      }
      return json(await session(u));
    }
    if (grant === "refresh_token") {
      const id = String(body.refresh_token ?? "").split(".")[1];
      const [u] = id ? await sql`select * from auth.users where id = ${id}` : [];
      if (!u) return json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }, 400);
      return json(await session(u));
    }
  }
  if (path === "/user") {
    const claims = await verifyJwt(req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? null);
    if (!claims) return json({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }, 401);
    const [u] = await sql`select * from auth.users where id = ${claims.sub as string}`;
    if (!u) return json({ code: 404, msg: "user not found" }, 404);
    return json((await session(u)).user);
  }
  if (path === "/logout") return new Response(null, { status: 204, headers: CORS });
  return json({ msg: `emulator: ${path} not implemented` }, 404);
}

Deno.serve({ port: PORT, hostname: "0.0.0.0", onListen: () => console.log(`supabase emulator on :${PORT}`) }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (url.pathname === "/__test/fail-functions") {
      failFunctions = url.searchParams.get("on") === "1";
      return json({ failFunctions });
    }
    if (url.pathname.startsWith("/functions/v1/")) {
      if (failFunctions) return new Response("unreachable", { status: 503, headers: CORS });
      const fn = url.pathname.split("/")[3];
      const r = fn === "dispatch-reminders" ? await dispatch(req) : fn === "notification-action" ? await notificationAction(req) : json({ error: "not found" }, 404);
      const h = new Headers(r.headers);
      Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, url);
    if (url.pathname.startsWith("/rest/v1/")) {
      const claims = await verifyJwt(req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? null);
      return await rest(req, url, claims);
    }
    if (url.pathname.startsWith("/realtime/")) return new Response("realtime not emulated", { status: 503, headers: CORS });
    return json({ error: "not found" }, 404);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    const code = (e as { code?: string })?.code ?? "PGRST000";
    return json({ message: m, code, details: null, hint: null }, code === "42501" ? 403 : 400);
  }
});
