import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidAuditEvent,
  isAuditEvent,
  AuditLoggingError,
  type AuditEvent
} from "../src/index.js";

const validEvent: AuditEvent = {
  action: "project.updated",
  actorId: "user-1",
  tenantId: "tenant-1",
  resourceType: "project",
  resourceId: "project-1",
  outcome: "success",
  metadata: {
    previousStatus: "planned",
    resultingStatus: "active"
  }
};

test("accepts a valid audit event", () => {
  assert.equal(isAuditEvent(validEvent), true);
  assert.doesNotThrow(() => assertValidAuditEvent(validEvent));
});

test("accepts nullable actor, tenant, and resource identifiers", () => {
  const event = {
    ...validEvent,
    actorId: null,
    tenantId: null,
    resourceId: null,
    outcome: "failure"
  };

  assert.equal(isAuditEvent(event), true);
});

test("accepts every supported outcome", () => {
  for (const outcome of ["success", "denied", "failure"] as const) {
    assert.equal(isAuditEvent({ ...validEvent, outcome }), true);
  }
});

test("accepts a valid timestamp and request identifier", () => {
  assert.equal(
    isAuditEvent({
      ...validEvent,
      occurredAt: new Date("2026-01-01T12:00:00.000Z"),
      requestId: "request-1"
    }),
    true
  );
});

test("accepts object metadata with a null prototype", () => {
  const metadata = Object.assign(Object.create(null), {
    attempt: 2
  });

  assert.equal(isAuditEvent({ ...validEvent, metadata }), true);
});

test("rejects null and non-object inputs", () => {
  for (const value of [null, undefined, "event", 42, []]) {
    assert.equal(isAuditEvent(value), false);
  }
});

const invalidCases: Array<[string, unknown]> = [
  ["action", ""],
  ["actorId", 12],
  ["tenantId", ""],
  ["resourceType", " "],
  ["resourceId", false],
  ["outcome", "unknown"],
  ["occurredAt", new Date(Number.NaN)],
  ["occurredAt", "not-a-date"],
  ["requestId", ""],
  ["metadata", []]
];

for (const [field, invalidValue] of invalidCases) {
  test(`rejects an invalid ${field} field`, () => {
    const event = { ...validEvent, [field]: invalidValue };

    assert.equal(isAuditEvent(event), false);

    assert.throws(
      () => assertValidAuditEvent(event),
      (error: unknown) =>
        error instanceof AuditLoggingError &&
        error.code === "AUDIT_EVENT_INVALID" &&
        error.field === field
    );
  });
}

test("reports malformed event objects with the event field", () => {
  assert.throws(
    () => assertValidAuditEvent(null),
    (error: unknown) =>
      error instanceof AuditLoggingError &&
      error.field === "event"
  );
});

test("does not mutate the supplied event during validation", () => {
  const event = { ...validEvent };
  const originalAction = event.action;

  assertValidAuditEvent(event);

  assert.equal(event.action, originalAction);
});
