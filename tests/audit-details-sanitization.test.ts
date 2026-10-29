import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAuditDetails } from "../src/app";

test("audit detail sanitizer keeps approved metadata and drops identifiers", () => {
  const result = sanitizeAuditDetails({
    status_before: "failed",
    status_after: "ready",
    verification_code: "CONNECTION_OK",
    discovery_code: "DISCOVERY_OK",
    duration_ms: 125,
    schema_count: 3,
    table_count: 12,
    tenant_id: "private-tenant-id",
    server_key: "internal-server-key",
    database_name: "internal-database-name",
    password: "must-not-be-returned",
    internal_notes: "must-not-be-returned",
  });

  assert.deepEqual(result, {
    status_before: "failed",
    status_after: "ready",
    verification_code: "CONNECTION_OK",
    discovery_code: "DISCOVERY_OK",
    duration_ms: 125,
    schema_count: 3,
    table_count: 12,
  });
});

test("audit detail sanitizer returns an empty object for invalid input", () => {
  assert.deepEqual(sanitizeAuditDetails(null), {});
  assert.deepEqual(sanitizeAuditDetails("private text"), {});
  assert.deepEqual(sanitizeAuditDetails(["private", "data"]), {});
});

test("audit detail sanitizer rejects invalid and oversized field values", () => {
  const result = sanitizeAuditDetails({
    status_before: "x".repeat(65),
    status_after: 123,
    verification_code: "CONNECTION_OK",
    duration_ms: -1,
    schema_count: Number.POSITIVE_INFINITY,
    table_count: 4,
  });

  assert.deepEqual(result, {
    verification_code: "CONNECTION_OK",
    table_count: 4,
  });
});
