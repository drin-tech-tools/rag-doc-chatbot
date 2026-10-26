import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTimeout } from "./async";

describe("withTimeout", () => {
  it("resolves when the promise wins the race", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "fast");
    assert.equal(value, 42);
  });

  it("rejects with a labeled timeout", async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => {}), 20, "embed"),
      /embed timed out after 20ms/,
    );
  });

  it("rejects when the abort signal fires", async () => {
    const abort = new AbortController();
    const pending = withTimeout(new Promise(() => {}), 5000, "retrieval", abort.signal);
    queueMicrotask(() => abort.abort());
    await assert.rejects(() => pending, /retrieval aborted/);
  });
});
