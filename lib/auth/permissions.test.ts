import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can, permissionsFor } from "./permissions";

describe("can()", () => {
  it("denies when user is missing", () => {
    assert.equal(can(null, "chat:use"), false);
    assert.equal(can(undefined, "documents:read:own"), false);
  });

  it("grants client own-doc + chat only", () => {
    const client = { role: "client" as const };
    assert.equal(can(client, "documents:read:own"), true);
    assert.equal(can(client, "documents:write:own"), true);
    assert.equal(can(client, "chat:use"), true);
    assert.equal(can(client, "documents:read:any"), false);
    assert.equal(can(client, "documents:write:any"), false);
    assert.equal(can(client, "users:manage"), false);
  });

  it("grants admin everything", () => {
    const admin = { role: "admin" as const };
    for (const p of permissionsFor("admin")) {
      assert.equal(can(admin, p), true);
    }
  });
});
