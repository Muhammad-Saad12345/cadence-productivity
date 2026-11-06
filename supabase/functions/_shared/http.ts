export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(req) },
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console[level === "info" ? "log" : level](JSON.stringify({ level, msg, ...extra, ts: new Date().toISOString() }));
}
