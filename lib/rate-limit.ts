/** Thrown when the embedding API is rate limited and we cannot (or will not) wait it out. */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(
      `Gemini rate limit reached. Please wait ${Math.ceil(retryAfterMs / 1000)}s and try again.`,
    );
    this.name = "RateLimitError";
  }
}

/** Fallback wait when a 429 does not say how long to back off. */
export const DEFAULT_RETRY_MS = 20_000;

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 429) return true;
  const msg = err instanceof Error ? err.message : "";
  return /RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(msg);
}

/**
 * Backoff hint from a Gemini 429: `"retryDelay":"27s"` in the body, or
 * "Please retry in 27.58s" in the message. Padded by 1s for clock skew.
 */
export function parseRetryDelayMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m =
    msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ??
    msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (!m) return DEFAULT_RETRY_MS;
  return Math.ceil(Number(m[1]) * 1000) + 1_000;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `fn`, retrying on rate-limit errors while the wait fits in `budgetMs`.
 * With no budget left the 429 surfaces as a `RateLimitError` carrying the wait.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { budgetMs: number; signal?: AbortSignal; onRetry?: (waitMs: number) => void },
): Promise<T> {
  const deadline = Date.now() + opts.budgetMs;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err)) throw err;
      const waitMs = parseRetryDelayMs(err);
      if (Date.now() + waitMs > deadline) throw new RateLimitError(waitMs);
      opts.onRetry?.(waitMs);
      await sleep(waitMs, opts.signal);
    }
  }
}
