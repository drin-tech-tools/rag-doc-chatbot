"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/app/components/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { completeEmailLinkFromLocation } from "@/lib/auth/complete-email-link";
import {
  hashHasAuthPayload,
  queryHasAuthPayload,
  safeNextPath,
} from "@/lib/auth/email-link";

/**
 * Invite / recovery / magic-link / OAuth landing page.
 * Handles PKCE `code`, `token_hash`+`type`, and implicit `#access_token` hash
 * (replaces the old server-only route that could not see URL fragments).
 */
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Completing sign-in…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const supabase = createClient();
        const href = window.location.href;
        const hasPayload =
          hashHasAuthPayload(window.location.hash) ||
          queryHasAuthPayload(window.location.search);

        if (hasPayload) {
          const result = await completeEmailLinkFromLocation(supabase, href);
          if (result.status === "error") {
            setMessage(result.message);
            router.replace(`/login?error=${encodeURIComponent(result.message)}`);
            return;
          }
          if (result.status === "ok") {
            router.replace(result.redirectTo);
            router.refresh();
            return;
          }
        }

        // Already have a session (e.g. cookies set) — route by next / MFA.
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login?error=auth_callback_failed");
          return;
        }

        const next = safeNextPath(searchParams.get("next"), "");
        if (next === "/auth/set-password") {
          router.replace("/auth/set-password");
          router.refresh();
          return;
        }

        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const current = aal?.currentLevel ?? "aal1";
        const nextLevel = aal?.nextLevel ?? "aal1";

        if (current === "aal2") {
          router.replace(next || "/");
        } else if (nextLevel === "aal2") {
          router.replace("/mfa/verify");
        } else if (next) {
          router.replace(next);
        } else {
          router.replace("/mfa/setup");
        }
        router.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Auth callback failed";
        setMessage(msg);
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      }
    })();
  }, [router, searchParams]);

  return (
    <AuthShell>
      <h1>Signing you in</h1>
      <p className="muted">{message}</p>
    </AuthShell>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <h1>Signing you in</h1>
          <p className="muted">Completing sign-in…</p>
        </AuthShell>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
