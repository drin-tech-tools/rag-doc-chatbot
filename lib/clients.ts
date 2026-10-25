import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.8-flash";
export const EMBED_DIM = 768; // must match vector(768) in the SQL migration

export function gemini() {
  return new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
}

export function supabase() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
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
