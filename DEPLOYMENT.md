# Deployment Guide

Step-by-step deploy for this RAG Doc Chatbot on free tiers (Supabase + Gemini + Vercel Hobby). Never commit real API keys or paste them into the repo.

## (a) Supabase — project & SQL

1. Use the **same** free Supabase project as `job-hunt-agent` (shared Auth + `user_roles`), or create one at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run, in order:
   - [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (if not already applied)
   - [`supabase/migrations/0002_auth_rbac.sql`](supabase/migrations/0002_auth_rbac.sql) — `user_roles`, `documents.owner_id`, scoped `match_chunks`, RLS
3. Expect: **Success. No rows returned** (idempotent `create table if not exists` / `add column if not exists`).

### Auth dashboard (required for MFA wall)

1. **Authentication → Providers → Email**: turn **Allow new users to sign up** **OFF** (invite-only).
2. **Authentication → Multi-Factor Auth**: enable **TOTP** (App Authenticator).
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://rag-doc-chatbot-brown.vercel.app`
   - **Redirect URLs**: add `https://rag-doc-chatbot-brown.vercel.app/auth/callback`
   - For local dev, also add `http://localhost:3000/auth/callback`
4. **Project Settings → API Keys**:
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - Copy **Publishable** key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Copy **Secret** key (`sb_secret_…` / service role) → `SUPABASE_SERVICE_ROLE_KEY` (server only)

### Bootstrap the first admin

Set `ADMIN_EMAIL` locally (and in Vercel), then either:

```bash
# From a machine with service role + ADMIN_EMAIL in env (.env.local or exported)
npm run bootstrap-admin
```

Or run this SQL alternative (replace placeholders; invite still needed via Dashboard or script for the Auth user):

```sql
-- After the user exists in auth.users (Dashboard → Users → Invite, or bootstrap script):
insert into public.user_roles (user_id, app, role)
values ('<auth-user-uuid>', 'rag-doc-chatbot', 'admin')
on conflict (user_id, app) do update set role = excluded.role;
```

The bootstrap script **invites** `ADMIN_EMAIL` and upserts `admin` for `rag-doc-chatbot`. It never sets or prints a password — the invitee opens the email, sets a password at `/auth/set-password`, then enrolls MFA.

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
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase **publishable** key (`sb_publishable_…`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **secret** / service role (`sb_secret_…`) — server only |
   | `ADMIN_EMAIL` | First admin’s email (for bootstrap; not a password) |
   | `NEXT_PUBLIC_SITE_URL` | (optional) `https://rag-doc-chatbot-brown.vercel.app` |
   | `GEMINI_CHAT_MODEL` | (optional) preferred chat model id |
   | `GEMINI_EMBED_MODEL` | (optional) defaults to `gemini-embedding-001` |

4. **Skip** the optional Supabase marketplace / integration wizard — it would provision a **second** database. You already created the project and ran the migrations manually.
5. Click **Deploy**. Build warnings (e.g. ESLint / dependency notices) are fine as long as the build succeeds.
6. After deploy, run `npm run bootstrap-admin` once (locally with the same env), accept the invite email, set password, enroll TOTP.

## (e) Verify

1. Open the deployed URL — you should be redirected to **/login** (no public access).
2. Sign in as the admin → complete **/mfa/setup** (first time) or **/mfa/verify**.
3. Open **/admin/users**, invite a **client**, confirm they can only see their own uploads.
4. Upload a small **text** PDF (under **4 MB**). Image-only / scanned PDFs will fail extraction.
5. Ask a question about the document; expect streamed answer + citations.
6. **Log out** clears the session globally (`/api/auth/logout`).

Live demo for this portfolio deploy: [https://rag-doc-chatbot-brown.vercel.app/](https://rag-doc-chatbot-brown.vercel.app/)

## (f) Troubleshooting

| Symptom | What to do |
|---|---|
| Redirect loop on MFA | Confirm TOTP is enabled in Supabase Auth → MFA. Reset the user’s factors from `/admin/users` → Reset MFA. |
| Invite email missing | Check Supabase Auth → Users and spam; confirm Site URL + Redirect URLs include `/auth/callback`. |
| `No role assigned` | Upsert `user_roles` for `app = 'rag-doc-chatbot'` (bootstrap script or admin invite). |
| **404 / model not available** | Set `GEMINI_CHAT_MODEL` to a model your key can access, or rely on the built-in fallback list in `lib/clients.ts`. |
| **Chat hangs / timeouts** | Overall chat budget is **45s**. In **Vercel → Deployments → Logs**, look for `[chat]` timing lines. |
| **Upload: no extractable text** | Use a text PDF (OCR not included). |
| **Upload rejected at 4 MB** | Vercel Hobby body limit — keep PDFs under **4 MB**. |

Never paste real keys into issues, screenshots, or commits. Rotate any key that was exposed.
