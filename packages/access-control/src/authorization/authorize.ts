import { isAccessAction } from "../permissions/permissions.js";
import type { AccessResource } from "../types/resource.js";
import type { AccessSubject } from "../types/subject.js";
import { authorizeDatabaseInstancePolicy } from "../policies/database-instance.policy.js";
import { authorizeProjectPolicy } from "../policies/project.policy.js";
import type {
  AccessDecision,
  AuthorizationDenialReason,
  AuthorizationRequest,
} from "./access-decision.js";

function deny(reason: AuthorizationDenialReason): AccessDecision {
  return { allowed: false, reason };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isValidSubject(value: unknown): value is AccessSubject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const subject = value as Record<string, unknown>;

  return (
    nonEmptyString(subject.id) &&
    isStringArray(subject.tenantIds) &&
    isStringArray(subject.projectIds) &&
    Array.isArray(subject.permissions) &&
    subject.permissions.every(isAccessAction)
  );
}

function isValidResource(value: unknown): value is AccessResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const resource = value as Record<string, unknown>;

  if (
    !nonEmptyString(resource.id) ||
    !nonEmptyString(resource.tenantId)
  ) {
    return false;
  }

  switch (resource.type) {
    case "tenant":
      return resource.id === resource.tenantId;

    case "project":
      return true;

    case "database-instance":
      return nonEmptyString(resource.projectId);

    default:
      return false;
  }
}

/**
 * Evaluates a trusted authorization context.
 *
 * This function does not authenticate the subject or load the resource.
 * The caller must perform those tasks using trusted server-side sources.
 */
export function authorize(
  request: AuthorizationRequest,
): AccessDecision {
  if (!request || typeof request !== "object") {
    return deny("invalid-subject");
  }

  const { subject, action, resource } = request;

  if (!isValidSubject(subject)) {
    return deny("invalid-subject");
  }

  if (!isValidResource(resource)) {
    return deny("invalid-resource");
  }

  if (!isAccessAction(action)) {
    return deny("unsupported-action");
  }

  if (action.startsWith("project:")) {
    return authorizeProjectPolicy(subject, action, resource);
  }

  return authorizeDatabaseInstancePolicy(subject, action, resource);
}
