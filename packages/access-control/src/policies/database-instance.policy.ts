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
 * Creating an instance is authorized against its parent project.
 * Other instance operations require the actual instance resource.
 */
export function authorizeDatabaseInstancePolicy(
  subject: AccessSubject,
  action: AccessAction,
  resource: AccessResource,
): AccessDecision {
  if (!action.startsWith("database-instance:")) {
    return deny("resource-action-mismatch");
  }

  const isCreate = action === "database-instance:create";

  if (isCreate && resource.type !== "project") {
    return deny("resource-action-mismatch");
  }

  if (!isCreate && resource.type !== "database-instance") {
    return deny("resource-action-mismatch");
  }

  if (!subject.tenantIds.includes(resource.tenantId)) {
    return deny("tenant-scope-denied");
  }

  const projectId =
    resource.type === "project"
      ? resource.id
      : resource.type === "database-instance"
        ? resource.projectId
        : undefined;

  if (!projectId || !subject.projectIds.includes(projectId)) {
    return deny("project-scope-denied");
  }

  if (!subject.permissions.includes(action)) {
    return deny("permission-missing");
  }

  return grant();
}
