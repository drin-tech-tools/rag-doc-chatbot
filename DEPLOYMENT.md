# Deployment Guide

Step-by-step deploy for this RAG Doc Chatbot on free tiers (Supabase + Gemini + Vercel Hobby). Never commit real API keys or paste them into the repo.

## (a) Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and run it.
3. Expect: **Success. No rows returned** (extensions/tables/function are created; nothing is selected).
4. Go to **Project Settings → API Keys → Secret keys**.
5. Copy the default **`sb_secret_…`** key. This is the new secret key format that replaces the legacy `service_role` JWT. Do **not** use the publishable / anon key — the app needs server-side write access for uploads and RPC.
6. Set `SUPABASE_URL` to `https://<project-ref>.supabase.co` (Project Settings → API / Data API).

In Vercel / `.env.local`, map that secret into `SUPABASE_SERVICE_ROLE_KEY` (env var name kept for compatibility; value is the `sb_secret_…` key).

## (b) Gemini API key

1. Create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Note: **Gemini 2.5 models are unavailable to many new free-tier users.** This app does not rely on 2.5 by default.
3. Defaults / failover (see `lib/clients.ts`):
   - Preferred override: `GEMINI_CHAT_MODEL` (optional)
   - Then: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-latest` → `gemini-3.6-flash` → `gemini-3.8-flash`
4. Embeddings default to `gemini-embedding-001` at **768 dimensions** (`GEMINI_EMBED_MODEL` optional). Dimension must match `vector(768)` in the migration.

## (c) GitHub

The repository must be **PUBLIC**.

Vercel **Hobby** cannot deploy private repos owned by a GitHub organization; that path forces a Pro trial. Keep the repo public (or use a personal public repo) when deploying on Hobby.

## (d) Vercel (Hobby)

1. Open [vercel.com/new](https://vercel.com/new) and import this repo on your **Hobby** team.
2. Keep the **Next.js** preset and default build settings (`next build` / Next.js defaults).
3. Add environment variables:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | Gemini API key |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **secret** key (`sb_secret_…`) |
   | `GEMINI_CHAT_MODEL` | (optional) preferred chat model id |
   | `GEMINI_EMBED_MODEL` | (optional) defaults to `gemini-embedding-001` |

4. **Skip** the optional Supabase marketplace / integration wizard — it would provision a **second** database. You already created the project and ran the migration manually.
5. Click **Deploy**. Build warnings (e.g. ESLint / dependency notices) are fine as long as the build succeeds.

## (e) Verify

1. Open the deployed URL.
2. Upload a small **text** PDF (under **4 MB**). Image-only / scanned PDFs will fail extraction.
3. Ask a question about the document.
4. Expect a **streamed** answer with inline `[n]` citations and a source panel (document, page, similarity, snippet).

Live demo for this portfolio deploy: [https://rag-doc-chatbot-brown.vercel.app/](https://rag-doc-chatbot-brown.vercel.app/)

## (f) Troubleshooting

| Symptom | What to do |
|---|---|
| **404 / model not available** | Set `GEMINI_CHAT_MODEL` to a model your key can access, or rely on the built-in fallback list in `lib/clients.ts` (`gemini-3.5-flash-lite` first). New free keys often cannot call 2.5 models. |
| **Chat hangs / timeouts** | Overall chat budget is **45s** (per-model first-token abort ~15s). In **Vercel → Deployments → Logs**, look for `[chat]` lines: `embed_ms`, `retrieval_ms`, `generation_ttft_ms` / `generation_ms`, `total_ms`, and `trying_model=…` / failover warnings. |
| **ByteString header error** | Sources travel in `X-Rag-Sources` as **base64(UTF-8 JSON)** so non-ASCII snippets stay valid HTTP header ByteStrings. Fixed in current `app/api/chat/route.ts` + client decode in `app/page.tsx`. Redeploy if you are on an older build. |
| **Upload: no extractable text** | Scanned / image-only PDFs have no text layer. Use a text PDF (or add OCR later — not in this app). |
| **Upload rejected at 4 MB** | Vercel Hobby request body limit. Keep PDFs under **4 MB**. |

Never paste real keys into issues, screenshots, or commits. Rotate any key that was exposed.
