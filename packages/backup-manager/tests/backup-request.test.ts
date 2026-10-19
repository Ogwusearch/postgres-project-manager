import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidBackupRequest,
  isBackupRequest,
  BackupManagerError,
  type BackupRequest
} from "../src/index.js";

const validRequest: BackupRequest = {
  instanceId: "instance-1",
  databaseName: "application_db",
  requestedBy: "user-1",
  format: "custom",
  reason: "Scheduled backup"
};

test("accepts a valid backup request", () => {
  assert.equal(isBackupRequest(validRequest), true);
  assert.doesNotThrow(() => assertValidBackupRequest(validRequest));
});

test("accepts a system task with a null requester", () => {
  assert.equal(
    isBackupRequest({ ...validRequest, requestedBy: null }),
    true
  );
});

test("accepts all supported backup formats", () => {
  for (const format of ["custom", "plain", "directory", "tar"]) {
    assert.equal(isBackupRequest({ ...validRequest, format }), true);
  }
});

test("accepts a request without an optional reason", () => {
  const { reason: _reason, ...request } = validRequest;
  assert.equal(isBackupRequest(request), true);
});

test("rejects null and non-object input", () => {
  for (const value of [null, undefined, "backup", 12, []]) {
    assert.equal(isBackupRequest(value), false);
  }
});

const invalidCases: Array<[string, unknown]> = [
  ["instanceId", ""],
  ["databaseName", " "],
  ["requestedBy", ""],
  ["format", "unknown"],
  ["reason", " "]
];

for (const [field, invalidValue] of invalidCases) {
  test(`rejects an invalid ${field}`, () => {
    const input = { ...validRequest, [field]: invalidValue };

    assert.equal(isBackupRequest(input), false);

    assert.throws(
      () => assertValidBackupRequest(input),
      (error: unknown) =>
        error instanceof BackupManagerError &&
        error.code === "BACKUP_INPUT_INVALID" &&
        error.field === field
    );
  });
}

test("reports a malformed request using the request field", () => {
  assert.throws(
    () => assertValidBackupRequest(null),
    (error: unknown) =>
      error instanceof BackupManagerError &&
      error.field === "request"
  );
});
