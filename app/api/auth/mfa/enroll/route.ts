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

  const supabase = await createClient();

  // Drop unfinished enrollments so reloading /mfa/setup does not stack factors.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const verified = (existing?.totp ?? []).filter((f) => f.status === "verified");
  if (verified.length > 0) {
    return NextResponse.json(
      { error: "MFA already enrolled. Use /mfa/verify.", code: "already_enrolled" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}
