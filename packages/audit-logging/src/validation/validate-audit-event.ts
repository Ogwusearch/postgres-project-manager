import { AUDIT_OUTCOMES } from "../types/audit-event.js";
import type { AuditEvent } from "../types/audit-event.js";
import { AuditLoggingError } from "../errors/audit-logging.error.js";

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

function isNullableNonEmptyString(value: unknown): boolean {
  return value === null || isNonEmptyString(value);
}

function validationError(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return "event";
  }

  if (!isNonEmptyString(value.action)) {
    return "action";
  }

  if (!isNullableNonEmptyString(value.actorId)) {
    return "actorId";
  }

  if (!isNullableNonEmptyString(value.tenantId)) {
    return "tenantId";
  }

  if (!isNonEmptyString(value.resourceType)) {
    return "resourceType";
  }

  if (!isNullableNonEmptyString(value.resourceId)) {
    return "resourceId";
  }

  if (
    typeof value.outcome !== "string" ||
    !AUDIT_OUTCOMES.includes(value.outcome as (typeof AUDIT_OUTCOMES)[number])
  ) {
    return "outcome";
  }

  if (
    value.occurredAt !== undefined &&
    (!(value.occurredAt instanceof Date) ||
      Number.isNaN(value.occurredAt.getTime()))
  ) {
    return "occurredAt";
  }

  if (
    value.requestId !== undefined &&
    !isNonEmptyString(value.requestId)
  ) {
    return "requestId";
  }

  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return "metadata";
  }

  return undefined;
}

/** Returns true when value satisfies the runtime audit-event contract. */
export function isAuditEvent(value: unknown): value is AuditEvent {
  return validationError(value) === undefined;
}

/** Validates an event and throws a typed error identifying an invalid field. */
export function assertValidAuditEvent(
  value: unknown
): asserts value is AuditEvent {
  const field = validationError(value);

  if (field !== undefined) {
    throw new AuditLoggingError(
      field === "event"
        ? "Audit event must be a plain object."
        : `Audit event has an invalid ${field} field.`,
      field
    );
  }
}
