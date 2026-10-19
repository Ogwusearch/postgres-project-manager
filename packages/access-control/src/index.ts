export { authorize } from "./authorization/authorize.js";

export type {
  AccessDecision,
  AuthorizationDenialReason,
  AuthorizationRequest,
} from "./authorization/access-decision.js";

export {
  AuthorizationError,
  throwIfDenied,
} from "./errors/authorization.error.js";

export {
  ACCESS_ACTIONS,
  isAccessAction,
} from "./permissions/permissions.js";



export type {
  AccessAction,
  AccessPermission,
} from "./types/permission.js";

export type {
  AccessResource,
  DatabaseInstanceResource,
  ProjectResource,
  TenantResource,
} from "./types/resource.js";

export type { AccessSubject } from "./types/subject.js";
