"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeEmailLinkFromLocation } from "@/lib/auth/complete-email-link";
import { hashHasAuthPayload, queryHasAuthPayload } from "@/lib/auth/email-link";

/**
 * Catches invite/recovery/magic-link landings on any page (incl. /login when
 * Supabase falls back to Site URL and middleware redirects). Hash tokens never
 * reach the server, so this must run client-side.
 */
export function AuthUrlHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (typeof window === "undefined") return;

    const { hash, search } = window.location;
    if (!hashHasAuthPayload(hash) && !queryHasAuthPayload(search)) return;

    // /auth/callback page owns the full flow + loading UI when on that route.
    if (pathname === "/auth/callback") return;

    ran.current = true;
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const result = await completeEmailLinkFromLocation(supabase);
        if (cancelled) return;
        if (result.status === "error") {
          router.replace(`/login?error=${encodeURIComponent(result.message)}`);
          return;
        }
        if (result.status === "ok") {
          router.replace(result.redirectTo);
          router.refresh();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Auth link failed";
        router.replace(`/login?error=${encodeURIComponent(message)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
