import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RETRY_MS,
  RateLimitError,
  isRateLimitError,
  parseRetryDelayMs,
  withRateLimitRetry,
} from "./rate-limit";

const body429 = JSON.stringify({
  error: {
    code: 429,
    message: "Please retry in 27.581297155s.",
    status: "RESOURCE_EXHAUSTED",
    details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "27s" }],
  },
});

function rateLimited(message = body429) {
  return Object.assign(new Error(message), { status: 429 });
}

describe("isRateLimitError", () => {
  it("detects a 429 status or a RESOURCE_EXHAUSTED body", () => {
    assert.equal(isRateLimitError(rateLimited()), true);
    assert.equal(isRateLimitError(new Error(body429)), true);
    assert.equal(isRateLimitError(new Error("boom")), false);
    assert.equal(isRateLimitError(null), false);
  });
});

describe("parseRetryDelayMs", () => {
  it("reads retryDelay from the body, padded by 1s", () => {
    assert.equal(parseRetryDelayMs(rateLimited()), 28_000);
  });

  it("falls back to the message text, then the default", () => {
    assert.equal(parseRetryDelayMs(new Error("Please retry in 3.2s.")), 4_200);
    assert.equal(parseRetryDelayMs(new Error("429")), DEFAULT_RETRY_MS);
  });
});

describe("withRateLimitRetry", () => {
  it("retries after the suggested delay and returns the result", async () => {
    let calls = 0;
    const waits: number[] = [];
    const out = await withRateLimitRetry(
      async () => {
        if (++calls === 1) throw rateLimited("Please retry in 0.01s.");
        return "ok";
      },
      { budgetMs: 5_000, onRetry: (ms) => waits.push(ms) },
    );
    assert.equal(out, "ok");
    assert.equal(calls, 2);
    assert.equal(waits.length, 1);
  });

  it("throws RateLimitError when the wait exceeds the budget", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRateLimitRetry(
          async () => {
            calls++;
            throw rateLimited();
          },
          { budgetMs: 1_000 },
        ),
      (err: unknown) => err instanceof RateLimitError && err.retryAfterMs === 28_000,
    );
    assert.equal(calls, 1);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRateLimitRetry(
          async () => {
            calls++;
            throw new Error("boom");
          },
          { budgetMs: 60_000 },
        ),
      /boom/,
    );
    assert.equal(calls, 1);
  });
});
