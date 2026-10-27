import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { requirePermission } from "@/lib/auth/session";
import { embed, supabase } from "@/lib/clients";
import { chunkPages } from "@/lib/chunk";
import { RateLimitError } from "@/lib/rate-limit";
import { extractPages } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Time left for waiting out Gemini 429s, leaving room for the DB insert and response. */
const UPLOAD_BUDGET_MS = 50_000;

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

    const started = performance.now();
    const pages = await extractPages(Buffer.from(await file.arrayBuffer()));
    const chunks = chunkPages(pages);
    if (!chunks.length)
      return NextResponse.json({ error: "No extractable text (scanned PDF?)" }, { status: 422 });

    // Embed before creating the document row so a failed embed never leaves an empty document.
    const embedStart = performance.now();
    const vectors = await embed(
      chunks.map((c) => c.content),
      { retryBudgetMs: UPLOAD_BUDGET_MS - (performance.now() - started) },
    );
    console.log(
      `[upload] embed_ms=${Math.round(performance.now() - embedStart)} chunks=${chunks.length} owner=${auth.ctx.user.id}`,
    );

    const db = supabase();
    const { data: doc, error: docErr } = await db
      .from("documents")
      .insert({ name: file.name, owner_id: auth.ctx.user.id })
      .select()
      .single();
    if (docErr) throw docErr;

    const rows = chunks.map((c, i) => ({
      document_id: doc.id,
      page: c.page,
      chunk_index: c.index,
      content: c.content,
      embedding: vectors[i],
    }));
    const insertStart = performance.now();
    const { error } = await db.from("chunks").insert(rows);
    if (error) {
      await db.from("documents").delete().eq("id", doc.id);
      throw error;
    }
    console.log(
      `[upload] insert_ms=${Math.round(performance.now() - insertStart)} total_ms=${Math.round(performance.now() - started)} documentId=${doc.id}`,
    );

    return NextResponse.json({
      documentId: doc.id,
      name: file.name,
      pages: pages.length,
      chunks: chunks.length,
    });
  } catch (e: unknown) {
    if (e instanceof RateLimitError) {
      console.warn(`[upload] rate limited, retry_after_ms=${e.retryAfterMs}`);
      return NextResponse.json(
        { error: e.message },
        { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } },
      );
    }
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error(`[upload] error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
