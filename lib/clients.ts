import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";
import { createAdminClient } from "@/lib/supabase/admin";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
export const EMBED_DIM = 768; // must match vector(768) in the SQL migration

/**
 * Default chat models for NEW free-tier Gemini API keys, ordered for latency.
 * Source: https://ai.google.dev/gemini-api/docs/models (updated 2026-10-22)
 * - 2.5 models are limited to prior users; new projects should use 3.5 Flash-Lite or 3.8 Flash
 * - gemini-3.5-flash-lite: "fastest, most cost-effective 3.5 model for high-throughput"
 * - gemini-3.1-flash-lite: free-tier Flash-Lite alternative
 * - gemini-flash-latest: hot-swapped latest Flash alias
 * - gemini-3.6-flash / gemini-3.8-flash: stable Flash fallbacks
 */
export const DEFAULT_CHAT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
] as const;

/** Prefer GEMINI_CHAT_MODEL when set, then defaults (deduped). */
export function chatModels(): string[] {
  const preferred = process.env.GEMINI_CHAT_MODEL?.trim();
  const ordered = preferred
    ? [preferred, ...DEFAULT_CHAT_MODELS.filter((m) => m !== preferred)]
    : [...DEFAULT_CHAT_MODELS];
  return [...new Set(ordered)];
}

/** @deprecated Prefer chatModels(); kept for callers that want a single label. */
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? DEFAULT_CHAT_MODELS[0];

/**
 * Lowest-latency thinking settings per model family.
 * Docs: https://ai.google.dev/gemini-api/docs/generate-content/thinking
 * - Flash-Lite / 3.6: MINIMAL ≈ "no thinking"
 * - 3.8 Flash: MINIMAL errors; use LOW
 * - 2.5 Flash*: thinkingBudget 0 disables
 * - Unknown / aliases: omit (caller may retry without config on rejection)
 */
export function thinkingConfigFor(model: string): ThinkingConfig | undefined {
  const m = model.toLowerCase();
  if (m.includes("2.5") && m.includes("flash")) {
    return { thinkingBudget: 0 };
  }
  if (m.includes("flash-lite") || m.includes("3.6-flash") || /(^|-)3-flash/.test(m)) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (m.includes("3.8-flash")) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

export function isThinkingConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /thinking|ThinkingLevel|thinkingConfig|thinking_budget|thinkingBudget|MINIMAL/i.test(msg);
}

export function gemini() {
  return new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
}

/** Service-role Supabase client (server-only). Always filter by owner explicitly. */
export function supabase() {
  return createAdminClient();
}

/** Batch-embed texts at EMBED_DIM so they stay compatible with existing pgvector data. */
export async function embed(texts: string[]): Promise<number[][]> {
  const ai = gemini();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: batch,
      config: { outputDimensionality: EMBED_DIM },
    });
    const vectors = res.embeddings ?? [];
    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, got ${vectors.length}`);
    }
    for (const e of vectors) {
      if (!e.values?.length) throw new Error("Embedding response missing values");
      out.push(e.values);
    }
  }
  return out;
}
