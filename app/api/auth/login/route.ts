import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const ip = clientIp(req);
  const limited = rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = aal?.currentLevel ?? "aal1";
  const next = aal?.nextLevel ?? "aal1";

  let redirectTo = "/";
  if (current !== "aal2") {
    redirectTo = current === "aal1" && next === "aal2" ? "/mfa/verify" : "/mfa/setup";
  }

  return NextResponse.json({
    ok: true,
    redirectTo,
    aal: { current, next },
  });
}
