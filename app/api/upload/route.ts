import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { requirePermission } from "@/lib/auth/session";
import { embed, supabase } from "@/lib/clients";
import { chunkPages } from "@/lib/chunk";
import { extractPages } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  const auth = await requirePermission("documents:write:own");
  if (!auth.ok) return auth.response;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf")
      return NextResponse.json({ error: "Please upload a PDF file" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024)
      return NextResponse.json({ error: "Max 4 MB (Vercel Hobby body limit)" }, { status: 400 });

    const pages = await extractPages(Buffer.from(await file.arrayBuffer()));
    const chunks = chunkPages(pages);
    if (!chunks.length)
      return NextResponse.json({ error: "No extractable text (scanned PDF?)" }, { status: 422 });

    const db = supabase();
    const { data: doc, error: docErr } = await db
      .from("documents")
      .insert({ name: file.name, owner_id: auth.ctx.user.id })
      .select()
      .single();
    if (docErr) throw docErr;

    const vectors = await embed(chunks.map((c) => c.content));
    const rows = chunks.map((c, i) => ({
      document_id: doc.id,
      page: c.page,
      chunk_index: c.index,
      content: c.content,
      embedding: vectors[i],
    }));
    const { error } = await db.from("chunks").insert(rows);
    if (error) throw error;

    return NextResponse.json({
      documentId: doc.id,
      name: file.name,
      pages: pages.length,
      chunks: chunks.length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
