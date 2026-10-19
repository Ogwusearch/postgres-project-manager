export { AuditLoggingError } from "./errors/audit-logging.error.js";

export {
  assertValidAuditEvent,
  isAuditEvent
} from "./validation/validate-audit-event.js";

export { AUDIT_OUTCOMES } from "./types/audit-event.js";

export type {
  AuditEvent,
  AuditOutcome
} from "./types/audit-event.js";

export type { AuditLogger } from "./types/audit-logger.js";
