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

let vapidReady = false;

/**
 * Generates the Web Push (VAPID) key pair inside Supabase the first time it is needed and stores it
 * in Vault, so the private key never leaves the project. No-op when keys are provided via env or
 * already exist. Serialised with an advisory lock so concurrent invocations can't create two pairs.
 */
export async function ensureVapidKeys(): Promise<void> {
  if (vapidReady || (optionalEnv("VAPID_PUBLIC_KEY") && optionalEnv("VAPID_PRIVATE_KEY"))) {
    vapidReady = true;
    return;
  }
  await db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('cadence_vapid_keys'))`;
    const rows = await tx`select name from vault.decrypted_secrets
                          where name in ('cadence_vapid_public_key', 'cadence_vapid_private_key')`;
    if (rows.length === 2) return;
    if (rows.length === 1) throw new Error("Vault holds only one VAPID key; delete it or add the other half");
    const { default: webpush } = await import("npm:web-push@3.6.7");
    const k = webpush.generateVAPIDKeys();
    await tx`select vault.create_secret(${k.publicKey}, 'cadence_vapid_public_key', 'Cadence Web Push public key')`;
    await tx`select vault.create_secret(${k.privateKey}, 'cadence_vapid_private_key', 'Cadence Web Push private key')`;
  });
  vapidReady = true;
}

export async function secret(name: keyof typeof VAULT_NAMES): Promise<string> {
  if (name === "VAPID_PUBLIC_KEY" || name === "VAPID_PRIVATE_KEY") await ensureVapidKeys();
  const fromEnv = optionalEnv(name);
  if (fromEnv) return fromEnv;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await db()`select decrypted_secret from vault.decrypted_secrets where name = ${VAULT_NAMES[name]}`;
  if (!row?.decrypted_secret) throw new Error(`Missing secret ${name} (env or vault:${VAULT_NAMES[name]})`);
  cache.set(name, { value: row.decrypted_secret, at: Date.now() });
  return row.decrypted_secret;
}
