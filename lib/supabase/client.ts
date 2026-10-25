"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser client — only NEXT_PUBLIC_* keys (never service role). */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / publishable key");
  }
  return createBrowserClient(url, key);
}
