export class AuditLoggingError extends Error {
  readonly code = "AUDIT_EVENT_INVALID";

  constructor(
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = "AuditLoggingError";
  }
}
