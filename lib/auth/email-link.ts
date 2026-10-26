/**
 * Pure helpers for invite / recovery / magic-link URL handling.
 * Supports implicit-flow hash tokens, PKCE `code`, and `token_hash` + `type`.
 */

export type EmailLinkType =
  | "invite"
  | "recovery"
  | "magiclink"
  | "signup"
  | "email"
  | "email_change"
  | string;

export type ParsedAuthHash = {
  accessToken: string | null;
  refreshToken: string | null;
  type: EmailLinkType | null;
  error: string | null;
  errorDescription: string | null;
};

export type ParsedAuthQuery = {
  code: string | null;
  tokenHash: string | null;
  type: EmailLinkType | null;
  next: string | null;
  error: string | null;
  errorDescription: string | null;
};

/** Safe in-app path only (blocks open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
}

export function parseAuthHash(hash: string): ParsedAuthHash {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    type: params.get("type"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

export function parseAuthQuery(search: string): ParsedAuthQuery {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    code: params.get("code"),
    tokenHash: params.get("token_hash"),
    type: params.get("type"),
    next: params.get("next"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

/** True when the URL fragment carries an implicit-flow session (or auth error). */
export function hashHasAuthPayload(hash: string): boolean {
  const parsed = parseAuthHash(hash);
  if (parsed.error || parsed.errorDescription) return true;
  return Boolean(parsed.accessToken && parsed.refreshToken);
}

/** True when search params need client or callback handling. */
export function queryHasAuthPayload(search: string): boolean {
  const parsed = parseAuthQuery(search);
  if (parsed.error || parsed.errorDescription) return true;
  return Boolean(parsed.code || (parsed.tokenHash && parsed.type));
}

/**
 * Where to send the user after an email link establishes a session.
 * Invites and recovery should set a password; other links go through MFA routing.
 */
export function nextPathAfterEmailLink(
  type: EmailLinkType | null | undefined,
  explicitNext?: string | null,
): string {
  const hinted = explicitNext ? safeNextPath(explicitNext, "") : "";
  if (hinted === "/auth/set-password") return "/auth/set-password";

  const t = (type ?? "").toLowerCase();
  if (t === "invite" || t === "recovery" || t === "signup") {
    return "/auth/set-password";
  }

  if (hinted) return hinted;
  // Let middleware finish MFA routing from the app root.
  return "/";
}

/** Strip auth-related query keys; keep unrelated params. */
export function stripAuthQueryParams(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  for (const key of [
    "code",
    "token_hash",
    "type",
    "next",
    "error",
    "error_description",
    "error_code",
  ]) {
    params.delete(key);
  }
  const out = params.toString();
  return out ? `?${out}` : "";
}
