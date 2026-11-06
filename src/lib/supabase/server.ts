import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client bound to the request cookies (route handlers / server actions). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
        }
      },
    },
  });
}
