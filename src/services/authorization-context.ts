import {
  ACCESS_ACTIONS,
  type AccessPermission,
  type AccessSubject,
} from "@postgres-project-manager/access-control";
import {
  type ActiveSession,
  type ActiveTenant,
  type TenantMembership,
  createAuthRepository,
} from "../repositories/auth.repository.js";

type AuthRepository = ReturnType<typeof createAuthRepository>;

export type TenantRole =
  | "super_admin"
  | TenantMembership["role"];

export interface TenantAuthorizationContext {
  userId: string;
  tenant: ActiveTenant;
  role: TenantRole;
  subject: AccessSubject;
}

export type AuthorizationContextResolution =
  | {
      ok: true;
      context: TenantAuthorizationContext;
    }
  | {
      ok: false;
      status: 400 | 403 | 404;
      error: string;
    };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const operatorPermissions: readonly AccessPermission[] = [
  "project:read",
  "database-instance:create",
  "database-instance:read",
  "database-instance:update",
];

const viewerPermissions: readonly AccessPermission[] = [
  "project:read",
  "database-instance:read",
];

function permissionsForRole(
  role: TenantRole,
): readonly AccessPermission[] {
  if (role === "super_admin" || role === "admin") {
    return ACCESS_ACTIONS;
  }

  if (role === "database_operator") {
    return operatorPermissions;
  }

  return viewerPermissions;
}

export async function resolveTenantAuthorizationContext(
  repository: AuthRepository,
  session: ActiveSession,
  requestedTenantId: string | undefined,
): Promise<AuthorizationContextResolution> {
  const headerTenantId = requestedTenantId?.trim() || undefined;

  if (headerTenantId && !uuidPattern.test(headerTenantId)) {
    return {
      ok: false,
      status: 400,
      error: "X-Tenant-Id must be a valid UUID.",
    };
  }

  let tenant: ActiveTenant;
  let role: TenantRole;
  let projectIds: string[];

  if (session.is_super_admin) {
    if (!headerTenantId) {
      return {
        ok: false,
        status: 400,
        error: "X-Tenant-Id is required for Super Admin tenant operations.",
      };
    }

    const activeTenant =
      await repository.findActiveTenant(headerTenantId);

    if (!activeTenant) {
      return {
        ok: false,
        status: 404,
        error: "Active tenant not found.",
      };
    }

    tenant = activeTenant;
    role = "super_admin";
    projectIds = await repository.listTenantProjectIds(tenant.id);
  } else {
    const memberships = await repository.listMemberships(session.user_id);

    if (memberships.length === 0) {
      return {
        ok: false,
        status: 403,
        error: "No active tenant membership is available.",
      };
    }

    if (!headerTenantId && memberships.length > 1) {
      return {
        ok: false,
        status: 400,
        error: "X-Tenant-Id is required when the user belongs to multiple tenants.",
      };
    }

    const membership = memberships.find(
      (item) => item.tenant_id === (headerTenantId ?? memberships[0].tenant_id),
    );

    if (!membership) {
      return {
        ok: false,
        status: 403,
        error: "The user does not have access to the requested tenant.",
      };
    }

    tenant = {
      id: membership.tenant_id,
      tenant_key: membership.tenant_key,
      name: membership.tenant_name,
      status: "active",
    };
    role = membership.role;

    projectIds =
      role === "admin"
        ? await repository.listTenantProjectIds(tenant.id)
        : await repository.listAssignedProjectIds(
            session.user_id,
            tenant.id,
          );
  }

  const subject: AccessSubject = {
    id: session.user_id,
    tenantIds: [tenant.id],
    projectIds,
    permissions: permissionsForRole(role),
  };

  return {
    ok: true,
    context: {
      userId: session.user_id,
      tenant,
      role,
      subject,
    },
  };
}
