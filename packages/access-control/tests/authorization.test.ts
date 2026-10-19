import assert from "node:assert/strict";
import test from "node:test";

import {
  authorize,
  AuthorizationError,
  throwIfDenied,
} from "../src/index.js";

import type {
  AccessResource,
  AccessSubject,
  AuthorizationRequest,
} from "../src/index.js";

const subject: AccessSubject = {
  id: "user-1",
  tenantIds: ["tenant-1"],
  projectIds: ["project-1"],
  permissions: [
    "project:read",
    "database-instance:read",
    "database-instance:delete",
  ],
};

const project: AccessResource = {
  type: "project",
  id: "project-1",
  tenantId: "tenant-1",
};

function makeRequest(
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return {
    subject,
    action: "project:read",
    resource: project,
    ...overrides,
  };
}

test("allows an explicitly permitted action in an assigned project", () => {
  assert.deepEqual(authorize(makeRequest()), {
    allowed: true,
    reason: "permission-granted",
  });
});

test("denies an action without an explicit permission", () => {
  assert.deepEqual(
    authorize(makeRequest({ action: "project:delete" })),
    { allowed: false, reason: "permission-missing" },
  );
});

test("denies cross-tenant access", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        resource: {
          type: "project",
          id: "project-1",
          tenantId: "tenant-2",
        },
      }),
    ),
    { allowed: false, reason: "tenant-scope-denied" },
  );
});

test("allows reading a database instance in an assigned project", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        action: "database-instance:read",
        resource: {
          type: "database-instance",
          id: "instance-1",
          tenantId: "tenant-1",
          projectId: "project-1",
        },
      }),
    ),
    { allowed: true, reason: "permission-granted" },
  );
});

test("denies deleting an instance without its deletion permission", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        subject: { ...subject, permissions: ["database-instance:read"] },
        action: "database-instance:delete",
        resource: {
          type: "database-instance",
          id: "instance-1",
          tenantId: "tenant-1",
          projectId: "project-1",
        },
      }),
    ),
    { allowed: false, reason: "permission-missing" },
  );
});

test("denies a database instance in an unassigned project", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        action: "database-instance:read",
        resource: {
          type: "database-instance",
          id: "instance-2",
          tenantId: "tenant-1",
          projectId: "project-2",
        },
      }),
    ),
    { allowed: false, reason: "project-scope-denied" },
  );
});

test("requires project scope to create a database instance", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        action: "database-instance:create",
        resource: project,
      }),
    ),
    { allowed: false, reason: "permission-missing" },
  );
});

test("rejects an incompatible action and resource type", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        action: "database-instance:delete",
        resource: project,
      }),
    ),
    { allowed: false, reason: "resource-action-mismatch" },
  );
});

test("denies a subject without an identity", () => {
  assert.deepEqual(
    authorize(
      makeRequest({
        subject: { ...subject, id: "" },
      }),
    ),
    { allowed: false, reason: "invalid-subject" },
  );
});

test("converts a denied decision to an authorization error", () => {
  assert.throws(
    () => throwIfDenied({
      allowed: false,
      reason: "permission-missing",
    }),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.reason === "permission-missing" &&
      error.code === "AUTHORIZATION_DENIED",
  );
});
