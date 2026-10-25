import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * OAuth / invite / magic-link callback.
 * Exchanges `code` for a session cookie, then routes to set-password or MFA.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const login = new URL("/login", url.origin);
      login.searchParams.set("error", "auth_callback_failed");
      return NextResponse.redirect(login);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  if (safeNext === "/auth/set-password") {
    return NextResponse.redirect(new URL("/auth/set-password", url.origin));
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = aal?.currentLevel ?? "aal1";
  const nextLevel = aal?.nextLevel ?? "aal1";

  if (current === "aal2") {
    return NextResponse.redirect(new URL(safeNext || "/", url.origin));
  }
  if (nextLevel === "aal2") {
    return NextResponse.redirect(new URL("/mfa/verify", url.origin));
  }
  // Invitees often land here before a password is set — prefer set-password when hinted.
  if (safeNext) {
    return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/mfa/setup", url.origin));
}
