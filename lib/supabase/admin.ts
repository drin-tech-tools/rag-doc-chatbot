import { createClient } from "@supabase/supabase-js";
import { publicSupabaseUrl, serviceRoleKey } from "./env";

/** Service-role client — server-only. Never import from client components. */
export function createAdminClient() {
  return createClient(publicSupabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
