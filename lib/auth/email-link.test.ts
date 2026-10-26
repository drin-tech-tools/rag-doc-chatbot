import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashHasAuthPayload,
  nextPathAfterEmailLink,
  parseAuthHash,
  parseAuthQuery,
  queryHasAuthPayload,
  safeNextPath,
  stripAuthQueryParams,
} from "./email-link";

describe("parseAuthHash", () => {
  it("extracts implicit-flow tokens and invite type", () => {
    const parsed = parseAuthHash(
      "#access_token=at123&refresh_token=rt456&token_type=bearer&type=invite",
    );
    assert.equal(parsed.accessToken, "at123");
    assert.equal(parsed.refreshToken, "rt456");
    assert.equal(parsed.type, "invite");
    assert.equal(parsed.error, null);
  });

  it("extracts recovery type and auth errors", () => {
    const ok = parseAuthHash("access_token=a&refresh_token=b&type=recovery");
    assert.equal(ok.type, "recovery");
    const err = parseAuthHash("#error=access_denied&error_description=Link%20expired");
    assert.equal(err.error, "access_denied");
    assert.equal(err.errorDescription, "Link expired");
    assert.equal(err.accessToken, null);
  });
});

describe("parseAuthQuery", () => {
  it("parses PKCE code and token_hash flows", () => {
    const code = parseAuthQuery("?code=abc&next=/auth/set-password");
    assert.equal(code.code, "abc");
    assert.equal(code.next, "/auth/set-password");
    const otp = parseAuthQuery("token_hash=th&type=invite&next=/auth/set-password");
    assert.equal(otp.tokenHash, "th");
    assert.equal(otp.type, "invite");
  });
});

describe("hashHasAuthPayload / queryHasAuthPayload", () => {
  it("detects hash tokens and rejects empty hash", () => {
    assert.equal(
      hashHasAuthPayload("#access_token=a&refresh_token=b&type=invite"),
      true,
    );
    assert.equal(hashHasAuthPayload("#type=invite"), false);
    assert.equal(hashHasAuthPayload(""), false);
    assert.equal(hashHasAuthPayload("#error=otp_expired"), true);
  });

  it("detects code and token_hash query payloads", () => {
    assert.equal(queryHasAuthPayload("?code=x"), true);
    assert.equal(queryHasAuthPayload("?token_hash=t&type=recovery"), true);
    assert.equal(queryHasAuthPayload("?next=/auth/set-password"), false);
  });
});

describe("nextPathAfterEmailLink", () => {
  it("routes invite/recovery/signup to set-password", () => {
    assert.equal(nextPathAfterEmailLink("invite"), "/auth/set-password");
    assert.equal(nextPathAfterEmailLink("recovery"), "/auth/set-password");
    assert.equal(nextPathAfterEmailLink("signup"), "/auth/set-password");
  });

  it("honors explicit set-password next and blocks open redirects", () => {
    assert.equal(
      nextPathAfterEmailLink("magiclink", "/auth/set-password"),
      "/auth/set-password",
    );
    assert.equal(nextPathAfterEmailLink("magiclink", "https://evil.test"), "/");
    assert.equal(nextPathAfterEmailLink("magiclink", "//evil.test"), "/");
    assert.equal(nextPathAfterEmailLink("magiclink", "/admin"), "/admin");
  });
});

describe("safeNextPath / stripAuthQueryParams", () => {
  it("only allows same-origin relative paths", () => {
    assert.equal(safeNextPath("/auth/set-password"), "/auth/set-password");
    assert.equal(safeNextPath("https://evil.test"), "/");
    assert.equal(safeNextPath(null, "/mfa/setup"), "/mfa/setup");
  });

  it("strips auth params but keeps unrelated ones", () => {
    assert.equal(
      stripAuthQueryParams("?code=1&token_hash=2&type=invite&next=/x&foo=bar"),
      "?foo=bar",
    );
    assert.equal(stripAuthQueryParams("?code=1"), "");
  });
});
