import type { AccessPermission } from "./permission.js";

/**
 * A trusted server-side representation of the requesting identity.
 *
 * Build this from authenticated identity, tenant membership, project
 * assignments, and permission data. Never copy these fields directly
 * from an untrusted HTTP request body.
 */
export interface AccessSubject {
  readonly id: string;
  readonly tenantIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly permissions: readonly AccessPermission[];
}
