import { NextResponse } from "next/server";
import { CHAT_MODEL, embed, gemini, supabase } from "@/lib/clients";

export const runtime = "nodejs";

interface Match { id: number; document_name: string; page: number; content: string; similarity: number }

export async function POST(req: Request) {
  try {
    const { question, documentId, k = 5 } = await req.json();
    if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

    const [qVec] = await embed([question]);
    const { data, error } = await supabase().rpc("match_chunks", {
      query_embedding: qVec, match_count: k, filter_document: documentId ?? null,
    });
    if (error) throw error;
    const sources = (data ?? []) as Match[];
    if (!sources.length) return NextResponse.json({ answer: "No documents indexed yet. Upload a PDF first.", sources: [] });

    const context = sources.map((s, i) => `[${i + 1}] (${s.document_name}, p.${s.page})\n${s.content}`).join("\n\n");
    const prompt = `You answer questions using ONLY the numbered sources below.
Cite sources inline like [1] or [2][3] after each claim. If the answer is not in the sources, say you don't know.

Sources:
${context}

Question: ${question}`;

    const result = await gemini().getGenerativeModel({ model: CHAT_MODEL }).generateContent(prompt);
    return NextResponse.json({
      answer: result.response.text(),
      sources: sources.map((s, i) => ({ n: i + 1, document: s.document_name, page: s.page, similarity: s.similarity, snippet: s.content.slice(0, 300) })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Chat failed" }, { status: 500 });
  }
}
