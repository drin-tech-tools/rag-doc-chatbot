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

  let body: { factorId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.factorId) {
    return NextResponse.json({ error: "factorId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.challenge({ factorId: body.factorId });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ challengeId: data.id });
}
