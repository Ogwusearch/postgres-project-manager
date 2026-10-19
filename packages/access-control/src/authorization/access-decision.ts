import type { AccessAction } from "../types/permission.js";
import type { AccessResource } from "../types/resource.js";
import type { AccessSubject } from "../types/subject.js";

export type AuthorizationDenialReason =
  | "invalid-subject"
  | "invalid-resource"
  | "unsupported-action"
  | "resource-action-mismatch"
  | "tenant-scope-denied"
  | "project-scope-denied"
  | "permission-missing";

export type AccessDecision =
  | {
      readonly allowed: true;
      readonly reason: "permission-granted";
    }
  | {
      readonly allowed: false;
      readonly reason: AuthorizationDenialReason;
    };

export interface AuthorizationRequest {
  readonly subject: AccessSubject;
  readonly action: AccessAction;
  readonly resource: AccessResource;
}
