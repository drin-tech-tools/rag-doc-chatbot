import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAal1AllowedPath } from "@/lib/auth/constants";
import { publicSupabaseKey, publicSupabaseUrl } from "./env";

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach(({ name, value }) => {
    to.cookies.set(name, value);
  });
  for (const header of ["cache-control", "expires", "pragma"] as const) {
    const v = from.headers.get(header);
    if (v) to.headers.set(header, v);
  }
  return to;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(publicSupabaseUrl(), publicSupabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const aal1Ok = isAal1AllowedPath(pathname);

  if (!user) {
    if (aal1Ok) return supabaseResponse;
    if (isApi) {
      return copyCookies(
        supabaseResponse,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return copyCookies(supabaseResponse, NextResponse.redirect(url));
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = aal?.currentLevel ?? "aal1";
  const next = aal?.nextLevel ?? "aal1";

  // Verified MFA factor exists but session is still AAL1 → must verify.
  const needsVerify = current === "aal1" && next === "aal2";
  // No verified factor yet → force enrollment.
  const needsSetup = current === "aal1" && next === "aal1";

  if (current !== "aal2") {
    if (aal1Ok) return supabaseResponse;

    if (isApi) {
      return copyCookies(
        supabaseResponse,
        NextResponse.json(
          { error: "MFA required", code: needsVerify ? "mfa_verify" : "mfa_setup" },
          { status: 401 },
        ),
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = needsVerify ? "/mfa/verify" : needsSetup ? "/mfa/setup" : "/mfa/verify";
    return copyCookies(supabaseResponse, NextResponse.redirect(url));
  }

  // AAL2: bounce away from login/mfa entry points (except logout/callback).
  if (pathname === "/login" || pathname === "/mfa/setup" || pathname === "/mfa/verify") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return copyCookies(supabaseResponse, NextResponse.redirect(url));
  }

  return supabaseResponse;
}
