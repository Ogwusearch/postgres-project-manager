import type { BackupRetentionPolicy } from "../types/retention-policy.js";
import { BackupManagerError } from "../errors/backup-manager.error.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getInvalidField(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return "policy";
  }

  if (typeof value.enabled !== "boolean") {
    return "enabled";
  }

  if (
    !Number.isSafeInteger(value.retainLast) ||
    (value.retainLast as number) < 1
  ) {
    return "retainLast";
  }

  if (
    !Number.isSafeInteger(value.maxAgeDays) ||
    (value.maxAgeDays as number) < 1
  ) {
    return "maxAgeDays";
  }

  if (typeof value.requireVerifiedBackupBeforePrune !== "boolean") {
    return "requireVerifiedBackupBeforePrune";
  }

  return undefined;
}

export function isBackupRetentionPolicy(
  value: unknown
): value is BackupRetentionPolicy {
  return getInvalidField(value) === undefined;
}

export function assertValidBackupRetentionPolicy(
  value: unknown
): asserts value is BackupRetentionPolicy {
  const field = getInvalidField(value);

  if (field !== undefined) {
    throw new BackupManagerError(
      field === "policy"
        ? "Backup retention policy must be a plain object."
        : `Backup retention policy has an invalid ${field} field.`,
      field
    );
  }
}
