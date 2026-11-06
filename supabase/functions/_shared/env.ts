export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === undefined || v === "" ? undefined : v;
}
