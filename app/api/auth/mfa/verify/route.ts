import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  let body: { factorId?: string; challengeId?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { factorId, challengeId, code } = body;
  if (!factorId || !challengeId || !code) {
    return NextResponse.json(
      { error: "factorId, challengeId, and code required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code: code.trim(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, redirectTo: "/" });
}
