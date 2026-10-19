import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidBackupRetentionPolicy,
  isBackupRetentionPolicy,
  BackupManagerError,
  type BackupRetentionPolicy
} from "../src/index.js";

const validPolicy: BackupRetentionPolicy = {
  enabled: true,
  retainLast: 7,
  maxAgeDays: 30,
  requireVerifiedBackupBeforePrune: true
};

test("accepts a valid retention policy", () => {
  assert.equal(isBackupRetentionPolicy(validPolicy), true);
  assert.doesNotThrow(() => assertValidBackupRetentionPolicy(validPolicy));
});

test("allows cleanup to be disabled without disabling policy validation", () => {
  assert.equal(
    isBackupRetentionPolicy({ ...validPolicy, enabled: false }),
    true
  );
});

test("rejects null and non-object values", () => {
  for (const value of [null, undefined, "policy", []]) {
    assert.equal(isBackupRetentionPolicy(value), false);
  }
});

const invalidCases: Array<[string, unknown]> = [
  ["enabled", "yes"],
  ["retainLast", 0],
  ["retainLast", -1],
  ["retainLast", 1.5],
  ["maxAgeDays", 0],
  ["maxAgeDays", -1],
  ["maxAgeDays", 2.5],
  ["requireVerifiedBackupBeforePrune", 1]
];

for (const [field, invalidValue] of invalidCases) {
  test(`rejects invalid retention policy field ${field}: ${String(invalidValue)}`, () => {
    const policy = { ...validPolicy, [field]: invalidValue };

    assert.equal(isBackupRetentionPolicy(policy), false);

    assert.throws(
      () => assertValidBackupRetentionPolicy(policy),
      (error: unknown) =>
        error instanceof BackupManagerError &&
        error.code === "BACKUP_INPUT_INVALID" &&
        error.field === field
    );
  });
}

test("does not mutate a valid retention policy", () => {
  const policy = { ...validPolicy };

  assertValidBackupRetentionPolicy(policy);

  assert.deepEqual(policy, validPolicy);
});
