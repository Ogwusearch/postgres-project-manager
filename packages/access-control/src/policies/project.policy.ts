import type {
  AccessDecision,
  AuthorizationDenialReason,
} from "../authorization/access-decision.js";
import type { AccessAction } from "../types/permission.js";
import type { AccessResource } from "../types/resource.js";
import type { AccessSubject } from "../types/subject.js";

function deny(reason: AuthorizationDenialReason): AccessDecision {
  return { allowed: false, reason };
}

function grant(): AccessDecision {
  return { allowed: true, reason: "permission-granted" };
}

/**
 * Project creation is authorized against a tenant.
 * Reading, updating, and deleting a project require project-level scope.
 */
export function authorizeProjectPolicy(
  subject: AccessSubject,
  action: AccessAction,
  resource: AccessResource,
): AccessDecision {
  if (!action.startsWith("project:")) {
    return deny("resource-action-mismatch");
  }

  if (action === "project:create") {
    if (resource.type !== "tenant") {
      return deny("resource-action-mismatch");
    }
  } else if (resource.type !== "project") {
    return deny("resource-action-mismatch");
  }

  if (!subject.tenantIds.includes(resource.tenantId)) {
    return deny("tenant-scope-denied");
  }

  if (
    resource.type === "project" &&
    !subject.projectIds.includes(resource.id)
  ) {
    return deny("project-scope-denied");
  }

  if (!subject.permissions.includes(action)) {
    return deny("permission-missing");
  }

  return grant();
}
