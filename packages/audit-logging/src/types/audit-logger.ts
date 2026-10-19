import type { AuditEvent } from "./audit-event.js";

/**
 * A port for recording audit events.
 *
 * The caller supplies its transaction context explicitly. A persistence
 * adapter must write through that same transaction when the audit event
 * accompanies a database mutation; it must not silently open a separate
 * connection or swallow a write failure.
 *
 * TTransaction is supplied by the integration layer, so this package
 * does not need a PostgreSQL dependency.
 */
export interface AuditLogger<TTransaction> {
  write(event: AuditEvent, transaction: TTransaction): Promise<void>;
}
