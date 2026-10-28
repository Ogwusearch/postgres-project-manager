import assert from "node:assert/strict";
import test from "node:test";

import {
  revokeLoginSessionBestEffort,
} from "../apps/admin-web/src/app/revoke-login-session";

test("session cleanup sends a CSRF-protected logout request", async () => {
  let capturedUrl: RequestInfo | URL | undefined;
  let capturedOptions: RequestInit | undefined;

  const fakeFetch: typeof fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, status: 204 } as Response;
  };

  await revokeLoginSessionBestEffort("test-csrf-token", fakeFetch);

  assert.equal(capturedUrl, "/api/auth/logout");
  assert.equal(capturedOptions?.method, "POST");
  assert.equal(capturedOptions?.credentials, "include");
  assert.equal(
    (capturedOptions?.headers as Record<string, string>)["x-csrf-token"],
    "test-csrf-token",
  );
});

test("session cleanup does not send a request without a CSRF token", async () => {
  let called = false;

  const fakeFetch: typeof fetch = async () => {
    called = true;
    return { ok: true, status: 204 } as Response;
  };

  await revokeLoginSessionBestEffort(null, fakeFetch);

  assert.equal(called, false);
});

test("session cleanup preserves the original failure when logout fetch rejects", async () => {
  const failingFetch: typeof fetch = async () => {
    throw new Error("network unavailable");
  };

  await assert.doesNotReject(
    revokeLoginSessionBestEffort("test-csrf-token", failingFetch),
  );
});
