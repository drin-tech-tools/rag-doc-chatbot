import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
}

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;
  await signOutEverywhere();
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  // Allow simple link logout; still same-origin navigations only.
  const host = req.headers.get("host");
  const referer = req.headers.get("referer");
  if (referer && host) {
    try {
      if (new URL(referer).host !== host) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  await signOutEverywhere();
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}
