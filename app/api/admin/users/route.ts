import { NextResponse } from "next/server";
import { APP_ID, ROLES, type AppRole } from "@/lib/auth/constants";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { requirePermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://rag-doc-chatbot-brown.vercel.app"
  );
}

export async function GET() {
  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const { data: roles, error: roleErr } = await admin
    .from("user_roles")
    .select("user_id, role")
    .eq("app", APP_ID);
  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  const roleByUser = new Map((roles ?? []).map((r) => [r.user_id, r.role as AppRole]));

  const users = (listed.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
    role: roleByUser.get(u.id) ?? null,
    factors: u.factors?.map((f) => ({
      id: f.id,
      status: f.status,
      factor_type: f.factor_type,
    })),
  }));

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const auth = await requirePermission("users:manage");
  if (!auth.ok) return auth.response;

  let body: {
    action?: string;
    email?: string;
    role?: string;
    userId?: string;
    factorId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const action = body.action;

  if (action === "invite") {
    const email = body.email?.trim().toLowerCase();
    const role = body.role as AppRole | undefined;
    if (!email || !role || !(ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: "email and role (admin|client) required" }, { status: 400 });
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl()}/auth/callback?next=/auth/set-password`,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const userId = data.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invite succeeded but no user id" }, { status: 500 });
    }

    const { error: roleErr } = await admin.from("user_roles").upsert(
      { user_id: userId, app: APP_ID, role },
      { onConflict: "user_id,app" },
    );
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, userId, email });
  }

  if (action === "set_role") {
    const userId = body.userId;
    const role = body.role as AppRole | undefined;
    if (!userId || !role || !(ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: "userId and role required" }, { status: 400 });
    }
    const { error } = await admin.from("user_roles").upsert(
      { user_id: userId, app: APP_ID, role },
      { onConflict: "user_id,app" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(body.userId, {
      ban_duration: "876000h",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "enable") {
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(body.userId, {
      ban_duration: "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    if (body.userId === auth.ctx.user.id) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }
    await admin.from("user_roles").delete().eq("user_id", body.userId).eq("app", APP_ID);
    const { error } = await admin.auth.admin.deleteUser(body.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_mfa") {
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const { data: userData, error: getErr } = await admin.auth.admin.getUserById(body.userId);
    if (getErr) return NextResponse.json({ error: getErr.message }, { status: 400 });

    const factors = userData.user?.factors ?? [];
    for (const f of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({
        id: f.id,
        userId: body.userId,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true, removed: factors.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
