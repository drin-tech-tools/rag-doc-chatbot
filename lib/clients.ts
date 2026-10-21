import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash";
export const EMBED_DIM = 768; // must match vector(768) in the SQL migration

export function gemini() { return new GoogleGenerativeAI(env("GEMINI_API_KEY")); }
export function supabase() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export async function embed(texts: string[]): Promise<number[][]> {
  const model = gemini().getGenerativeModel({ model: EMBED_MODEL });
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await model.batchEmbedContents({
      requests: batch.map((t) => ({ content: { role: "user", parts: [{ text: t }] }, outputDimensionality: EMBED_DIM } as any)),
    });
    out.push(...res.embeddings.map((e) => e.values));
  }
  return out;
}
