import type { GenerateContentResponse } from "@google/genai";
import {
  chatModels,
  embed,
  gemini,
  isThinkingConfigError,
  supabase,
  thinkingConfigFor,
} from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHAT_TIMEOUT_MS = 45_000;
const FIRST_TOKEN_TIMEOUT_MS = 15_000;

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

type LiveStream = {
  model: string;
  firstText: string;
  rest: AsyncGenerator<string, void, unknown>;
  ttftMs: number;
  attemptAbort: AbortController;
};

function msSince(start: number) {
  return Math.round(performance.now() - start);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function extractAnswerTexts(chunk: GenerateContentResponse): string[] {
  const out: string[] = [];
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (!part.text || part.thought) continue;
    out.push(part.text);
  }
  if (!parts.length && chunk.text) out.push(chunk.text);
  return out;
}

function linkAbort(parent: AbortSignal, child: AbortController) {
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

async function* answerTokenStream(
  geminiStream: AsyncGenerator<GenerateContentResponse, unknown, unknown>,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of geminiStream) {
    if (signal.aborted) {
      throw new Error("Chat timed out after 45s. Try a shorter question or try again.");
    }
    for (const text of extractAnswerTexts(chunk)) {
      yield text;
    }
  }
}

async function openModelStream(
  model: string,
  prompt: string,
  signal: AbortSignal,
): Promise<AsyncGenerator<GenerateContentResponse, unknown, unknown>> {
  const ai = gemini();
  const configs: Array<ReturnType<typeof thinkingConfigFor> | undefined> = [
    thinkingConfigFor(model),
    undefined,
  ];
  // Deduplicate when thinkingConfigFor already returns undefined
  const unique = configs.filter((c, i, arr) => i === arr.findIndex((x) => JSON.stringify(x) === JSON.stringify(c)));

  let lastErr: unknown;
  for (const thinkingConfig of unique) {
    try {
      return await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: {
          abortSignal: signal,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (thinkingConfig && isThinkingConfigError(err)) {
        console.warn(
          `[chat] model=${model} rejected thinkingConfig (${msg}); retrying without thinkingConfig`,
        );
        continue;
      }
      // Surface non-thinking API errors immediately (do not wait for TTFT).
      console.error(`[chat] model=${model} api_error:`, msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Stream open failed"));
}

async function startWithFailover(
  prompt: string,
  overallSignal: AbortSignal,
  overallStarted: number,
): Promise<LiveStream> {
  const models = chatModels();
  console.log(`[chat] model_order=${models.join(",")}`);

  const errors: string[] = [];

  for (const model of models) {
    if (overallSignal.aborted) break;

    const elapsed = msSince(overallStarted);
    const remaining = CHAT_TIMEOUT_MS - elapsed;
    if (remaining < 1_000) break;

    const ttftBudget = Math.min(FIRST_TOKEN_TIMEOUT_MS, remaining);
    const attemptAbort = new AbortController();
    const unlink = linkAbort(overallSignal, attemptAbort);
    const attemptStarted = performance.now();
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      console.log(`[chat] trying_model=${model} ttft_budget_ms=${ttftBudget}`);
      const geminiStream = await openModelStream(model, prompt, attemptAbort.signal);
      const tokens = answerTokenStream(geminiStream, attemptAbort.signal);
      const iterator = tokens[Symbol.asyncIterator]();

      const first = await new Promise<IteratorResult<string, void>>((resolve, reject) => {
        firstTokenTimer = setTimeout(() => {
          attemptAbort.abort();
          reject(new Error(`TTFT_TIMEOUT model=${model} after ${ttftBudget}ms`));
        }, ttftBudget);

        iterator
          .next()
          .then(resolve, reject)
          .finally(() => {
            if (firstTokenTimer) clearTimeout(firstTokenTimer);
          });
      });

      if (first.done || !first.value) {
        errors.push(`${model}: empty stream`);
        console.warn(`[chat] model=${model} empty_stream`);
        attemptAbort.abort();
        unlink();
        continue;
      }

      const firstText = first.value;
      const ttftMs = msSince(attemptStarted);
      console.log(`[chat] model=${model} answered generation_ttft_ms=${ttftMs}`);

      // Keep overall→attempt abort link for the lifetime of the response stream.
      async function* rest(): AsyncGenerator<string, void, unknown> {
        yield firstText;
        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          if (next.value !== undefined) yield next.value;
        }
      }

      return { model, firstText, rest: rest(), ttftMs, attemptAbort };
    } catch (err) {
      unlink();
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${model}: ${msg}`);
      if (/TTFT_TIMEOUT/i.test(msg)) {
        console.warn(`[chat] model=${model} no_first_token_within_ms=${ttftBudget}; trying next`);
      } else if (overallSignal.aborted || /aborted|timeout/i.test(msg)) {
        console.warn(`[chat] model=${model} aborted:`, msg);
      } else {
        // API / config errors already logged in openModelStream; continue failover.
        console.warn(`[chat] model=${model} failed_fast:`, msg);
      }
    } finally {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
    }
  }

  if (overallSignal.aborted) {
    throw new Error("Chat timed out after 45s. Try a shorter question or try again.");
  }
  throw new Error(
    `All chat models failed before first token. Tried: ${models.join(", ")}. ${errors.slice(-3).join(" | ")}`,
  );
}

export async function POST(req: Request) {
  const started = performance.now();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), CHAT_TIMEOUT_MS);
  let live: LiveStream | null = null;

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
    live = await startWithFailover(prompt, abort.signal, started);

    const encoder = new TextEncoder();
    const chosenModel = live.model;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const text of live!.rest) {
            if (abort.signal.aborted) {
              throw new Error("Chat timed out after 45s. Try a shorter question or try again.");
            }
            controller.enqueue(encoder.encode(text));
          }
          console.log(
            `[chat] model=${chosenModel} generation_ms=${msSince(generationStart)} total_ms=${msSince(started)}`,
          );
          controller.close();
        } catch (e: unknown) {
          const message =
            abort.signal.aborted || (e instanceof Error && /aborted|timeout/i.test(e.message))
              ? "Chat timed out after 45s. Try a shorter question or try again."
              : e instanceof Error
                ? e.message
                : "Chat failed";
          console.error(`[chat] generation_error model=${chosenModel} total_ms=${msSince(started)}:`, message);
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
        live?.attemptAbort.abort();
        clearTimeout(timeout);
      },
    });

    // Base64(UTF-8 JSON) so curly quotes / non-ASCII in snippets stay valid HTTP header ByteStrings.
    const sourcesHeader = Buffer.from(JSON.stringify(sourcePayload), "utf8").toString("base64");

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Rag-Sources": sourcesHeader,
        "X-Chat-Model": chosenModel,
        "X-Chat-TTFT-Ms": String(live.ttftMs),
        "Access-Control-Expose-Headers": "X-Rag-Sources, X-Chat-Model, X-Chat-TTFT-Ms",
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
