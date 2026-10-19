import assert from "node:assert/strict";
import test from "node:test";

import { authorizeProjectPolicy } from "../src/policies/project.policy.js";
import type { AccessSubject } from "../src/types/subject.js";

const subject: AccessSubject = {
  id: "user-1",
  tenantIds: ["tenant-1"],
  projectIds: ["project-1"],
  permissions: ["project:create", "project:read", "project:update"],
};

test("allows reading an assigned project with permission", () => {
  assert.deepEqual(
    authorizeProjectPolicy(subject, "project:read", {
      type: "project",
      id: "project-1",
      tenantId: "tenant-1",
    }),
    { allowed: true, reason: "permission-granted" },
  );
});

test("denies a project outside the subject's project scope", () => {
  assert.deepEqual(
    authorizeProjectPolicy(subject, "project:read", {
      type: "project",
      id: "project-2",
      tenantId: "tenant-1",
    }),
    { allowed: false, reason: "project-scope-denied" },
  );
});

test("denies a project belonging to another tenant", () => {
  assert.deepEqual(
    authorizeProjectPolicy(subject, "project:read", {
      type: "project",
      id: "project-1",
      tenantId: "tenant-2",
    }),
    { allowed: false, reason: "tenant-scope-denied" },
  );
});

test("requires a tenant resource for project creation", () => {
  assert.deepEqual(
    authorizeProjectPolicy(subject, "project:create", {
      type: "project",
      id: "project-1",
      tenantId: "tenant-1",
    }),
    { allowed: false, reason: "resource-action-mismatch" },
  );
});

test("allows project creation for a tenant with permission", () => {
  assert.deepEqual(
    authorizeProjectPolicy(subject, "project:create", {
      type: "tenant",
      id: "tenant-1",
      tenantId: "tenant-1",
    }),
    { allowed: true, reason: "permission-granted" },
  );
});

test("denies project updates when the permission is missing", () => {
  assert.deepEqual(
    authorizeProjectPolicy(
      { ...subject, permissions: ["project:read"] },
      "project:update",
      {
        type: "project",
        id: "project-1",
        tenantId: "tenant-1",
      },
    ),
    { allowed: false, reason: "permission-missing" },
  );
});
