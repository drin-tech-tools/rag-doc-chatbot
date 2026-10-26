/**
 * Bootstrap / re-invite ADMIN_EMAIL and grant admin for rag-doc-chatbot.
 * Never prints or hardcodes passwords — invitee sets password via email link.
 *
 * - New user: sends an invite email.
 * - Existing user (invite already consumed): sends a recovery email so they can
 *   finish at /auth/set-password → MFA enroll.
 *
 * Implemented with plain `fetch` against the Auth Admin + PostgREST APIs so the
 * script runs on **Node 20** (modern `@supabase/supabase-js` pulls Node-22-only
 * `ws` / WebSocket bits that break `tsx` on Node 20).
 *
 * Usage: npm run bootstrap-admin
 * Requires: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL
 */

const APP_ID = "rag-doc-chatbot";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function adminHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.msg === "string") return o.msg;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.error === "string") return o.error;
  }
  return fallback;
}

async function inviteUser(
  base: string,
  serviceKey: string,
  email: string,
  redirectTo: string,
): Promise<{ userId: string | null; error: string | null }> {
  const res = await fetch(`${base}/auth/v1/invite`, {
    method: "POST",
    headers: adminHeaders(serviceKey),
    body: JSON.stringify({ email, data: {}, redirectTo }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    return { userId: null, error: errorMessage(body, `Invite failed (${res.status})`) };
  }
  const id =
    body && typeof body === "object" && body !== null && "id" in body
      ? String((body as { id: unknown }).id)
      : null;
  return { userId: id, error: null };
}

async function listUsersPage(
  base: string,
  serviceKey: string,
  page: number,
  perPage: number,
): Promise<{ id: string; email?: string }[]> {
  const url = new URL(`${base}/auth/v1/admin/users`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url, { headers: adminHeaders(serviceKey) });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(body, `listUsers failed (${res.status})`));
  }
  if (body && typeof body === "object" && Array.isArray((body as { users?: unknown }).users)) {
    return (body as { users: { id: string; email?: string }[] }).users;
  }
  if (Array.isArray(body)) return body as { id: string; email?: string }[];
  return [];
}

async function findUserIdByEmail(
  base: string,
  serviceKey: string,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const users = await listUsersPage(base, serviceKey, page, 200);
    const existing = users.find((u) => u.email?.toLowerCase() === email);
    if (existing) return existing.id;
    if (users.length < 200) break;
  }
  return null;
}

async function sendRecovery(
  base: string,
  serviceKey: string,
  email: string,
  redirectTo: string,
): Promise<void> {
  const res = await fetch(`${base}/auth/v1/recover`, {
    method: "POST",
    headers: adminHeaders(serviceKey),
    body: JSON.stringify({ email, gotrue_meta_security: {}, redirect_to: redirectTo }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    // Some projects expect `redirectTo` instead of `redirect_to`.
    const retry = await fetch(`${base}/auth/v1/recover`, {
      method: "POST",
      headers: adminHeaders(serviceKey),
      body: JSON.stringify({ email, redirectTo }),
    });
    const retryBody = await readJson(retry);
    if (!retry.ok) {
      throw new Error(errorMessage(retryBody, errorMessage(body, `Recovery failed (${res.status})`)));
    }
  }
}

async function upsertAdminRole(
  base: string,
  serviceKey: string,
  userId: string,
): Promise<void> {
  const res = await fetch(`${base}/rest/v1/user_roles?on_conflict=user_id,app`, {
    method: "POST",
    headers: {
      ...adminHeaders(serviceKey),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: userId, app: APP_ID, role: "admin" }),
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(errorMessage(body, `user_roles upsert failed (${res.status})`));
  }
}

async function main() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  if (!url) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
    process.exit(1);
  }
  const base = url.replace(/\/$/, "");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = required("ADMIN_EMAIL").toLowerCase();
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://rag-doc-chatbot-brown.vercel.app";

  const redirectTo = `${site}/auth/callback?next=/auth/set-password`;

  console.log(`Bootstrapping ${adminEmail} as admin for ${APP_ID}…`);
  console.log(`redirectTo: ${redirectTo}`);

  const invited = await inviteUser(base, serviceKey, adminEmail, redirectTo);
  let userId = invited.userId;
  let emailed: "invite" | "recovery" = "invite";

  if (invited.error) {
    const msg = invited.error.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      userId = await findUserIdByEmail(base, serviceKey, adminEmail);
      if (!userId) {
        console.error(`Invite failed (${invited.error}) and user not found.`);
        process.exit(1);
      }
      console.log("User already exists; sending recovery email so they can set a password.");
      await sendRecovery(base, serviceKey, adminEmail, redirectTo);
      emailed = "recovery";
    } else {
      console.error(invited.error);
      process.exit(1);
    }
  } else {
    console.log("Invite email sent (password is never set by this script).");
  }

  if (!userId) {
    console.error("No user id");
    process.exit(1);
  }

  await upsertAdminRole(base, serviceKey, userId);

  console.log(`Granted role admin for app=${APP_ID} user_id=${userId}`);
  if (emailed === "recovery") {
    console.log(
      "Open the recovery email → set password at /auth/set-password → enroll MFA.",
    );
  } else {
    console.log("Open the invite email → set password → enroll MFA.");
  }
  console.log(
    "Ensure Supabase Redirect URLs allowlist includes this redirectTo (see DEPLOYMENT.md).",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
