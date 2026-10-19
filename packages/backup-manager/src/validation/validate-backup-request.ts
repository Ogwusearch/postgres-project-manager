import { BACKUP_FORMATS } from "../types/backup.js";
import type { BackupRequest } from "../types/backup.js";
import { BackupManagerError } from "../errors/backup-manager.error.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getInvalidField(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return "request";
  }

  if (!isNonEmptyString(value.instanceId)) {
    return "instanceId";
  }

  if (!isNonEmptyString(value.databaseName)) {
    return "databaseName";
  }

  if (
    value.requestedBy !== null &&
    !isNonEmptyString(value.requestedBy)
  ) {
    return "requestedBy";
  }

  if (
    typeof value.format !== "string" ||
    !BACKUP_FORMATS.includes(value.format as (typeof BACKUP_FORMATS)[number])
  ) {
    return "format";
  }

  if (
    value.reason !== undefined &&
    !isNonEmptyString(value.reason)
  ) {
    return "reason";
  }

  return undefined;
}

export function isBackupRequest(value: unknown): value is BackupRequest {
  return getInvalidField(value) === undefined;
}

export function assertValidBackupRequest(
  value: unknown
): asserts value is BackupRequest {
  const field = getInvalidField(value);

  if (field !== undefined) {
    throw new BackupManagerError(
      field === "request"
        ? "Backup request must be a plain object."
        : `Backup request has an invalid ${field} field.`,
      field
    );
  }
}
