/** App id stored in shared `public.user_roles.app` (same Supabase project as job-hunt-agent). */
export const APP_ID = "rag-doc-chatbot" as const;

export type AppRole = "admin" | "client";

export const ROLES = ["admin", "client"] as const;

/** Paths reachable without an AAL2 session (login / MFA / invite / logout). */
export const AAL1_ALLOWED_PATHS = [
  "/login",
  "/mfa/setup",
  "/mfa/verify",
  "/auth/callback",
  "/auth/set-password",
  "/api/auth",
] as const;

export function isAal1AllowedPath(pathname: string): boolean {
  return AAL1_ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
