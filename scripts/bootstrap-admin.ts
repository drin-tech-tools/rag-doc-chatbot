/**
 * One-time bootstrap: invite ADMIN_EMAIL and grant admin for rag-doc-chatbot.
 * Never prints or hardcodes passwords — invitee sets password via email link.
 *
 * Usage: npm run bootstrap-admin
 * Requires: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL
 */
import { createClient } from "@supabase/supabase-js";

const APP_ID = "rag-doc-chatbot";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  if (!url) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
    process.exit(1);
  }
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = required("ADMIN_EMAIL").toLowerCase();
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://rag-doc-chatbot-brown.vercel.app";

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Inviting ${adminEmail} as admin for ${APP_ID}…`);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(adminEmail, {
    redirectTo: `${site}/auth/callback?next=/auth/set-password`,
  });

  let userId = data.user?.id;

  if (error) {
    // Already registered — look up and still ensure role
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) {
        console.error(listErr.message);
        process.exit(1);
      }
      const existing = listed.users.find((u) => u.email?.toLowerCase() === adminEmail);
      if (!existing) {
        console.error(`Invite failed (${error.message}) and user not found in first 200 users.`);
        process.exit(1);
      }
      userId = existing.id;
      console.log("User already exists; ensuring admin role.");
    } else {
      console.error(error.message);
      process.exit(1);
    }
  } else {
    console.log("Invite email sent (password is never set by this script).");
  }

  if (!userId) {
    console.error("No user id");
    process.exit(1);
  }

  const { error: roleErr } = await admin.from("user_roles").upsert(
    { user_id: userId, app: APP_ID, role: "admin" },
    { onConflict: "user_id,app" },
  );
  if (roleErr) {
    console.error(roleErr.message);
    process.exit(1);
  }

  console.log(`Granted role admin for app=${APP_ID} user_id=${userId}`);
  console.log("Open the invite email → set password → enroll MFA.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
