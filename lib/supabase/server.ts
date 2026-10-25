import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseKey, publicSupabaseUrl } from "./env";

/** Cookie-based Supabase client for Server Components, Server Actions, Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicSupabaseUrl(), publicSupabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — middleware refreshes the session.
        }
      },
    },
  });
}
