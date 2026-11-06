import postgres from "postgres";
import { env } from "./env.ts";

let client: ReturnType<typeof postgres> | null = null;

/**
 * Direct Postgres connection (SUPABASE_DB_URL is injected into every Supabase Edge Function).
 * prepare:false keeps it compatible with the transaction pooler.
 * The connection is reused across warm invocations.
 */
export function db() {
  if (!client) {
    client = postgres(env("SUPABASE_DB_URL"), {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return client;
}
