import type { GenerateContentResponse } from "@google/genai";
import { withTimeout } from "@/lib/async";
import { assertSameOrigin } from "@/lib/auth/csrf";
import { ownerScope, requirePermission } from "@/lib/auth/session";
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
/** Cap waiting for generateContentStream() to even open (before first token). */
const STREAM_OPEN_TIMEOUT_MS = 10_000;
/** Cap waiting for the first answer token after the stream is open. */
const FIRST_TOKEN_TIMEOUT_MS = 12_000;
const EMBED_TIMEOUT_MS = 12_000;
const RETRIEVAL_TIMEOUT_MS = 8_000;

interface Match {
  id: number;
  document_id: string;
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

type ChatPhase = "auth" | "embed" | "retrieval" | "generation";

function msSince(start: number) {
  return Math.round(performance.now() - start);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function timeoutMessage(phase: ChatPhase) {
  return `Chat timed out during ${phase} after ${CHAT_TIMEOUT_MS / 1000}s. Try again, or set GEMINI_CHAT_MODEL to a model your key can reach.`;
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
      throw new Error("generation aborted");
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
  const unique = configs.filter(
    (c, i, arr) => i === arr.findIndex((x) => JSON.stringify(x) === JSON.stringify(c)),
  );

  let lastErr: unknown;
  for (const thinkingConfig of unique) {
    try {
      const openStarted = performance.now();
      const stream = await withTimeout(
        ai.models.generateContentStream({
          model,
          contents: prompt,
          config: {
            abortSignal: signal,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        }),
        STREAM_OPEN_TIMEOUT_MS,
        `stream_open model=${model}`,
        signal,
      );
      console.log(
        `[chat] model=${model} stream_open_ms=${msSince(openStarted)} thinking=${thinkingConfig ? "on" : "off"}`,
      );
      return stream;
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
      console.log(
        `[chat] trying_model=${model} ttft_budget_ms=${ttftBudget} remaining_ms=${remaining}`,
      );
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
      if (/TTFT_TIMEOUT|stream_open.*timed out/i.test(msg)) {
        console.warn(`[chat] model=${model} no_first_token:`, msg);
      } else if (overallSignal.aborted || /aborted|timeout/i.test(msg)) {
        console.warn(`[chat] model=${model} aborted:`, msg);
      } else {
        console.warn(`[chat] model=${model} failed_fast:`, msg);
      }
    } finally {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
    }
  }

  if (overallSignal.aborted) {
    throw new Error(timeoutMessage("generation"));
  }
  throw new Error(
    `All chat models failed before first token. Tried: ${models.join(", ")}. ${errors.slice(-3).join(" | ")}`,
  );
}

export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;

  let phase: ChatPhase = "auth";
  const authStarted = performance.now();
  const auth = await requirePermission("chat:use");
  if (!auth.ok) return auth.response;
  console.log(`[chat] auth_ms=${msSince(authStarted)} role=${auth.ctx.role}`);

  const started = performance.now();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), CHAT_TIMEOUT_MS);
  let live: LiveStream | null = null;

  try {
    const { question, documentId, k = 5 } = await req.json();
    if (!question) return jsonError("question is required", 400);

    // Non-admins may only query their own documents (and optionally one of theirs).
    const filterOwner = ownerScope(auth.ctx);
    console.log(
      `[chat] question_len=${String(question).length} documentId=${documentId ?? "null"} filter_owner=${filterOwner ?? "null (admin-all)"} k=${k}`,
    );

    if (documentId && filterOwner) {
      const { data: owned, error: ownErr } = await supabase()
        .from("documents")
        .select("id")
        .eq("id", documentId)
        .eq("owner_id", filterOwner)
        .maybeSingle();
      if (ownErr) throw ownErr;
      if (!owned) return jsonError("Document not found", 404);
    }

    phase = "embed";
    const embedStart = performance.now();
    const embedBudget = Math.max(
      1_000,
      Math.min(EMBED_TIMEOUT_MS, CHAT_TIMEOUT_MS - msSince(started)),
    );
    const [qVec] = await withTimeout(
      embed([question], { signal: abort.signal }),
      embedBudget,
      "embed",
      abort.signal,
    );
    console.log(`[chat] embed_ms=${msSince(embedStart)} dims=${qVec?.length ?? 0}`);

    if (abort.signal.aborted) {
      return jsonError(timeoutMessage("embed"), 504);
    }

    phase = "retrieval";
    const retrievalStart = performance.now();
    const retrievalBudget = Math.max(
      1_000,
      Math.min(RETRIEVAL_TIMEOUT_MS, CHAT_TIMEOUT_MS - msSince(started)),
    );
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase().rpc("match_chunks", {
          query_embedding: qVec,
          match_count: k,
          filter_document: documentId ?? null,
          filter_owner: filterOwner,
        }),
      ),
      retrievalBudget,
      "retrieval",
      abort.signal,
    );
    console.log(
      `[chat] retrieval_ms=${msSince(retrievalStart)} sources=${(data ?? []).length} rpc_error=${error?.message ?? "none"}`,
    );
    if (error) throw error;

    const sources = (data ?? []) as Match[];
    if (!sources.length) {
      console.log(`[chat] total_ms=${msSince(started)} (no sources)`);
      return Response.json({
        answer:
          documentId
            ? "No chunks found for that document. Re-upload the PDF, or pick another document."
            : "No documents indexed yet. Upload a PDF first.",
        sources: [],
      });
    }

    console.log(
      `[chat] top_sources=${sources
        .slice(0, 3)
        .map((s) => `${s.document_name}:p${s.page}@${s.similarity?.toFixed?.(3) ?? "?"}`)
        .join(", ")}`,
    );

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
      return jsonError(timeoutMessage("retrieval"), 504);
    }

    phase = "generation";
    const generationStart = performance.now();
    live = await startWithFailover(prompt, abort.signal, started);

    const encoder = new TextEncoder();
    const chosenModel = live.model;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const text of live!.rest) {
            if (abort.signal.aborted) {
              throw new Error(timeoutMessage("generation"));
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
              ? timeoutMessage("generation")
              : e instanceof Error
                ? e.message
                : "Chat failed";
          console.error(
            `[chat] generation_error model=${chosenModel} total_ms=${msSince(started)}:`,
            message,
          );
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
    const timedOut = abort.signal.aborted || (e instanceof Error && /timed out/i.test(e.message));
    const message = timedOut
      ? e instanceof Error && /timed out during/i.test(e.message)
        ? e.message
        : timeoutMessage(phase)
      : e instanceof Error
        ? e.message
        : "Chat failed";
    console.error(`[chat] error phase=${phase} total_ms=${msSince(started)}:`, message);
    return jsonError(message, timedOut ? 504 : 500);
  }
}
