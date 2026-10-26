"use client";

import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";
import {
  hashHasAuthPayload,
  nextPathAfterEmailLink,
  parseAuthHash,
  parseAuthQuery,
  queryHasAuthPayload,
  stripAuthQueryParams,
} from "./email-link";

const OTP_TYPES = new Set<string>([
  "invite",
  "recovery",
  "magiclink",
  "signup",
  "email",
  "email_change",
]);

export type CompleteEmailLinkResult =
  | { status: "none" }
  | { status: "ok"; redirectTo: string }
  | { status: "error"; message: string };

function cleanUrlPreservePath() {
  const url = new URL(window.location.href);
  const cleanedSearch = stripAuthQueryParams(url.search);
  const nextUrl = `${url.pathname}${cleanedSearch}`;
  window.history.replaceState({}, document.title, nextUrl);
}

/**
 * Consume invite/recovery/magic-link payloads from the current URL.
 * Handles: `#access_token` (implicit), `?token_hash&type` (OTP), `?code` (PKCE).
 */
export async function completeEmailLinkFromLocation(
  supabase: SupabaseClient,
  href: string = typeof window !== "undefined" ? window.location.href : "",
): Promise<CompleteEmailLinkResult> {
  if (!href) return { status: "none" };

  const url = new URL(href);
  const hash = url.hash;
  const search = url.search;

  if (!hashHasAuthPayload(hash) && !queryHasAuthPayload(search)) {
    return { status: "none" };
  }

  const hashParsed = parseAuthHash(hash);
  if (hashParsed.error || hashParsed.errorDescription) {
    cleanUrlPreservePath();
    return {
      status: "error",
      message: hashParsed.errorDescription || hashParsed.error || "Auth link failed",
    };
  }

  const queryParsed = parseAuthQuery(search);
  if (queryParsed.error || queryParsed.errorDescription) {
    cleanUrlPreservePath();
    return {
      status: "error",
      message: queryParsed.errorDescription || queryParsed.error || "Auth link failed",
    };
  }

  // 1) Implicit flow — tokens only exist in the fragment (never sent to the server).
  if (hashParsed.accessToken && hashParsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: hashParsed.accessToken,
      refresh_token: hashParsed.refreshToken,
    });
    cleanUrlPreservePath();
    if (error) {
      return { status: "error", message: error.message };
    }
    return {
      status: "ok",
      redirectTo: nextPathAfterEmailLink(hashParsed.type, queryParsed.next),
    };
  }

  // 2) Email OTP / token_hash links (invite, recovery, magiclink, …).
  if (queryParsed.tokenHash && queryParsed.type && OTP_TYPES.has(queryParsed.type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: queryParsed.tokenHash,
      type: queryParsed.type as EmailOtpType,
    });
    cleanUrlPreservePath();
    if (error) {
      return { status: "error", message: error.message };
    }
    return {
      status: "ok",
      redirectTo: nextPathAfterEmailLink(queryParsed.type, queryParsed.next),
    };
  }

  // 3) PKCE auth code.
  if (queryParsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(queryParsed.code);
    cleanUrlPreservePath();
    if (error) {
      return { status: "error", message: error.message };
    }
    return {
      status: "ok",
      redirectTo: nextPathAfterEmailLink(queryParsed.type, queryParsed.next),
    };
  }

  return { status: "none" };
}
