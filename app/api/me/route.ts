import { NextResponse } from "next/server";
import { requireAal2 } from "@/lib/auth/session";
import { can, permissionsFor } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAal2();
  if (!auth.ok) return auth.response;
  const { user, role } = auth.ctx;
  return NextResponse.json({
    id: user.id,
    email: user.email,
    role,
    permissions: permissionsFor(role),
    canManageUsers: can({ role }, "users:manage"),
  });
}
