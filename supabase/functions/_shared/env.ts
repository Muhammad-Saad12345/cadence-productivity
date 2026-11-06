import { db } from "./db.ts";

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === undefined || v === "" ? undefined : v;
}

// Secrets can come from Edge Function secrets (env) or, if unset there, from Supabase Vault.
// Vault lets secrets be generated inside the database so they never leave it in plain text.
const VAULT_NAMES: Record<string, string> = {
  CRON_SECRET: "cadence_cron_secret",
  NOTIFICATION_ACTION_SECRET: "cadence_action_secret",
  VAPID_PUBLIC_KEY: "cadence_vapid_public_key",
  VAPID_PRIVATE_KEY: "cadence_vapid_private_key",
  VAPID_SUBJECT: "cadence_vapid_subject",
};
const cache = new Map<string, { value: string; at: number }>();
const TTL_MS = 5 * 60_000;

export async function secret(name: keyof typeof VAULT_NAMES): Promise<string> {
  const fromEnv = optionalEnv(name);
  if (fromEnv) return fromEnv;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await db()`select decrypted_secret from vault.decrypted_secrets where name = ${VAULT_NAMES[name]}`;
  if (!row?.decrypted_secret) throw new Error(`Missing secret ${name} (env or vault:${VAULT_NAMES[name]})`);
  cache.set(name, { value: row.decrypted_secret, at: Date.now() });
  return row.decrypted_secret;
}
