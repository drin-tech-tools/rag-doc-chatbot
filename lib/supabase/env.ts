/** Public URL — required for browser + SSR cookie clients. */
export function publicSupabaseUrl(): string {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  if (!v) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  return v;
}

/**
 * Publishable / anon key for user-scoped clients only.
 * Prefer NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (`sb_publishable_…`);
 * NEXT_PUBLIC_SUPABASE_ANON_KEY is accepted for older projects.
 */
export function publicSupabaseKey(): string {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!v) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return v;
}

export function serviceRoleKey(): string {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!v) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return v;
}
