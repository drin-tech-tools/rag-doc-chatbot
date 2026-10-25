import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_ID, type AppRole, ROLES } from "./constants";
import { can, type Permission } from "./permissions";

export type AuthContext = {
  user: User;
  role: AppRole;
  aal: "aal1" | "aal2";
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, ...(code ? { code } : {}) }, { status });
}

function parseRole(raw: unknown): AppRole | null {
  if (typeof raw !== "string") return null;
  return (ROLES as readonly string[]).includes(raw) ? (raw as AppRole) : null;
}

/** Load role for this app from shared `user_roles` (service role; filtered by user_id + app). */
export async function getAppRole(userId: string): Promise<AppRole | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("app", APP_ID)
    .maybeSingle();
  if (error) throw error;
  return parseRole(data?.role);
}

/**
 * Re-check session inside every route handler (never trust middleware alone).
 * Requires AAL2 by default.
 */
export async function requireAal2(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: Response }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = aal?.currentLevel ?? "aal1";
  if (current !== "aal2") {
    return {
      ok: false,
      response: jsonError("MFA required", 401, "mfa_required"),
    };
  }

  const role = await getAppRole(user.id);
  if (!role) {
    return { ok: false, response: jsonError("No role assigned for this app", 403) };
  }

  return { ok: true, ctx: { user, role, aal: "aal2" } };
}

/** AAL1+ session (login / MFA / set-password flows). */
export async function requireSession(): Promise<
  { ok: true; user: User; aal: "aal1" | "aal2" } | { ok: false; response: Response }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = (aal?.currentLevel === "aal2" ? "aal2" : "aal1") as "aal1" | "aal2";
  return { ok: true, user, aal: current };
}

export async function requirePermission(
  permission: Permission,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: Response }> {
  const auth = await requireAal2();
  if (!auth.ok) return auth;
  if (!can({ role: auth.ctx.role }, permission)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return auth;
}

/** Owner filter for service-role queries: null = admin (all), else own user id. */
export function ownerScope(ctx: AuthContext): string | null {
  return can({ role: ctx.role }, "documents:read:any") ? null : ctx.user.id;
}
