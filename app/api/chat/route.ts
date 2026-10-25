import { ThinkingLevel } from "@google/genai";
import { CHAT_MODEL, embed, gemini, supabase } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHAT_TIMEOUT_MS = 45_000;

interface Match {
  id: number;
  document_name: string;
  page: number;
  content: string;
  similarity: number;
}

type SourceOut = {
  n: number;
  document: string;
  page: number;
  similarity: number;
  snippet: string;
};

function msSince(start: number) {
  return Math.round(performance.now() - start);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const started = performance.now();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), CHAT_TIMEOUT_MS);

  try {
    const { question, documentId, k = 5 } = await req.json();
    if (!question) return jsonError("question is required", 400);

    const embedStart = performance.now();
    const [qVec] = await embed([question]);
    console.log(`[chat] embed_ms=${msSince(embedStart)}`);

    if (abort.signal.aborted) {
      return jsonError("Chat timed out after 45s. Try a shorter question or try again.", 504);
    }

    const retrievalStart = performance.now();
    const { data, error } = await supabase().rpc("match_chunks", {
      query_embedding: qVec,
      match_count: k,
      filter_document: documentId ?? null,
    });
    console.log(`[chat] retrieval_ms=${msSince(retrievalStart)}`);
    if (error) throw error;

    const sources = (data ?? []) as Match[];
    if (!sources.length) {
      console.log(`[chat] total_ms=${msSince(started)} (no sources)`);
      return Response.json({
        answer: "No documents indexed yet. Upload a PDF first.",
        sources: [],
      });
    }

    const sourcePayload: SourceOut[] = sources.map((s, i) => ({
      n: i + 1,
      document: s.document_name,
      page: s.page,
      similarity: s.similarity,
      snippet: s.content.slice(0, 300),
    }));

    const context = sources
      .map((s, i) => `[${i + 1}] (${s.document_name}, p.${s.page})\n${s.content}`)
      .join("\n\n");
    const prompt = `You answer questions using ONLY the numbered sources below.
Cite sources inline like [1] or [2][3] after each claim. If the answer is not in the sources, say you don't know.

Sources:
${context}

Question: ${question}`;

    if (abort.signal.aborted) {
      return jsonError("Chat timed out after 45s. Try a shorter question or try again.", 504);
    }

    const generationStart = performance.now();
    const ai = gemini();
    const geminiStream = await ai.models.generateContentStream({
      model: CHAT_MODEL,
      contents: prompt,
      config: {
        abortSignal: abort.signal,
        // gemini-3.8-flash supports LOW (not MINIMAL); cuts latency vs default MEDIUM
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const encoder = new TextEncoder();
    let firstToken = true;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            if (abort.signal.aborted) {
              throw new Error("Chat timed out after 45s. Try a shorter question or try again.");
            }
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if (!part.text || part.thought) continue;
              if (firstToken) {
                console.log(`[chat] generation_ttft_ms=${msSince(generationStart)}`);
                firstToken = false;
              }
              controller.enqueue(encoder.encode(part.text));
            }
            // Fallback when parts are absent but aggregated text is present
            if (!parts.length && chunk.text) {
              if (firstToken) {
                console.log(`[chat] generation_ttft_ms=${msSince(generationStart)}`);
                firstToken = false;
              }
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
          console.log(`[chat] generation_ms=${msSince(generationStart)} total_ms=${msSince(started)}`);
          controller.close();
        } catch (e: unknown) {
          const message =
            abort.signal.aborted || (e instanceof Error && /aborted|timeout/i.test(e.message))
              ? "Chat timed out after 45s. Try a shorter question or try again."
              : e instanceof Error
                ? e.message
                : "Chat failed";
          console.error(`[chat] generation_error total_ms=${msSince(started)}:`, message);
          try {
            controller.enqueue(encoder.encode(`\n\n[Error] ${message}`));
          } catch {
            /* stream may already be closed */
          }
          controller.close();
        } finally {
          clearTimeout(timeout);
        }
      },
      cancel() {
        abort.abort();
        clearTimeout(timeout);
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Rag-Sources": JSON.stringify(sourcePayload),
        "X-Chat-Model": CHAT_MODEL,
      },
    });
  } catch (e: unknown) {
    clearTimeout(timeout);
    const timedOut = abort.signal.aborted;
    const message = timedOut
      ? "Chat timed out after 45s. Try a shorter question or try again."
      : e instanceof Error
        ? e.message
        : "Chat failed";
    console.error(`[chat] error total_ms=${msSince(started)}:`, message);
    return jsonError(message, timedOut ? 504 : 500);
  }
}
