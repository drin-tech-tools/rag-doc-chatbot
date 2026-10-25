/**
 * Same-origin check for cookie-authenticated mutating requests.
 * Browsers send Origin on cross-site POSTs; missing Origin (same-site nav / some tools)
 * falls back to Referer host match.
 */
export function assertSameOrigin(req: Request): Response | null {
  const host = req.headers.get("host");
  if (!host) return Response.json({ error: "Missing Host" }, { status: 400 });

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host === host) return null;
    } catch {
      /* fall through */
    }
    return Response.json({ error: "CSRF: origin mismatch" }, { status: 403 });
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host === host) return null;
    } catch {
      /* fall through */
    }
    return Response.json({ error: "CSRF: referer mismatch" }, { status: 403 });
  }

  // No Origin/Referer — reject browser-like mutations; allow server-to-server only via explicit header
  // is not used here. Prefer fail-closed for cookie sessions.
  return Response.json({ error: "CSRF: missing origin" }, { status: 403 });
}
