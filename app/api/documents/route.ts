import { NextResponse } from "next/server";
import { ownerScope, requirePermission } from "@/lib/auth/session";
import { supabase } from "@/lib/clients";

export const runtime = "nodejs";

/** List documents the caller may read (own docs, or all for admin). */
export async function GET() {
  const auth = await requirePermission("documents:read:own");
  if (!auth.ok) return auth.response;

  const filterOwner = ownerScope(auth.ctx);
  let query = supabase()
    .from("documents")
    .select("id, name, created_at, owner_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (filterOwner) {
    query = query.eq("owner_id", filterOwner);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    documents: (data ?? []).map((d) => ({
      documentId: d.id as string,
      name: d.name as string,
      createdAt: d.created_at as string,
    })),
  });
}
