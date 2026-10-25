/**
 * Best-effort in-memory rate limiter (per serverless isolate).
 * Not a hard guarantee across Vercel instances — slows credential stuffing.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { ok: b.count <= limit, remaining, retryAfterSec };
}

/** Client IP from common proxy headers (best effort). */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}
