import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";

export interface AuthUser {
  id: string;
  email: string;
  password_hash: string;
  is_super_admin: boolean;
  status: "active" | "disabled";
}

export interface AuthSession {
  id: string;
  user_id: string;
  csrf_token_hash: string;
  expires_at: Date;
  user_agent: string | null;
  client_ip: string | null;
}

export interface ActiveSession extends AuthSession {
  email: string;
  is_super_admin: boolean;
  user_status: "active" | "disabled";
}

export interface TenantMembership {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  tenant_status: "active" | "suspended";
  role: "admin" | "database_operator" | "viewer";
}

export interface ActiveTenant {
  id: string;
  tenant_key: string;
  name: string;
  status: "active";
}

export interface SessionInsert {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: Date;
  user_agent: string | null;
  client_ip: string | null;
}

export function createAuthRepository(executor: SqlExecutor) {
  return {
    async findUserByEmail(email: string): Promise<AuthUser | null> {
      const result = await executor.query<AuthUser>(
        `SELECT id, email, password_hash, is_super_admin, status
         FROM public.users
         WHERE email = $1
         LIMIT 1`,
        [email],
      );

      return result.rows[0] ?? null;
    },

    async createSession(input: SessionInsert): Promise<void> {
      await executor.query(
        `INSERT INTO public.auth_sessions
          (id, user_id, token_hash, csrf_token_hash, expires_at,
           user_agent, client_ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.user_id,
          input.token_hash,
          input.csrf_token_hash,
          input.expires_at,
          input.user_agent,
          input.client_ip,
        ],
      );
    },

    async findActiveSession(
      tokenHash: string,
    ): Promise<ActiveSession | null> {
      const result = await executor.query<ActiveSession>(
        `SELECT
           s.id,
           s.user_id,
           s.csrf_token_hash,
           s.expires_at,
           s.user_agent,
           host(s.client_ip) AS client_ip,
           u.email,
           u.is_super_admin,
           u.status AS user_status
         FROM public.auth_sessions AS s
         JOIN public.users AS u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND u.status = 'active'
         LIMIT 1`,
        [tokenHash],
      );

      return result.rows[0] ?? null;
    },

    async touchSession(sessionId: string): Promise<void> {
      await executor.query(
        `UPDATE public.auth_sessions
         SET last_seen_at = now()
         WHERE id = $1
           AND revoked_at IS NULL
           AND expires_at > now()`,
        [sessionId],
      );
    },

    async revokeSession(tokenHash: string): Promise<void> {
      await executor.query(
        `UPDATE public.auth_sessions
         SET revoked_at = now()
         WHERE token_hash = $1
           AND revoked_at IS NULL`,
        [tokenHash],
      );
    },

    async findActiveTenant(tenantId: string): Promise<ActiveTenant | null> {
      const result = await executor.query<ActiveTenant>(
        `SELECT id, tenant_key, name, status
         FROM public.tenants
         WHERE id = $1
           AND status = 'active'
         LIMIT 1`,
        [tenantId],
      );

      return result.rows[0] ?? null;
    },

    async listMemberships(userId: string): Promise<TenantMembership[]> {
      const result = await executor.query<TenantMembership>(
        `SELECT
           t.id AS tenant_id,
           t.tenant_key,
           t.name AS tenant_name,
           t.status AS tenant_status,
           m.role
         FROM public.tenant_memberships AS m
         JOIN public.tenants AS t ON t.id = m.tenant_id
         WHERE m.user_id = $1
           AND t.status = 'active'
         ORDER BY t.name, t.id`,
        [userId],
      );

      return result.rows;
    },

    async listTenantProjectIds(tenantId: string): Promise<string[]> {
      const result = await executor.query<{ id: string }>(
        `SELECT id
         FROM public.projects
         WHERE tenant_id = $1
         ORDER BY id`,
        [tenantId],
      );

      return result.rows.map((row) => row.id);
    },

    async listAssignedProjectIds(
      userId: string,
      tenantId: string,
    ): Promise<string[]> {
      const result = await executor.query<{ project_id: string }>(
        `SELECT a.project_id
         FROM public.project_assignments AS a
         JOIN public.projects AS p
           ON p.id = a.project_id
          AND p.tenant_id = a.tenant_id
         WHERE a.user_id = $1
           AND a.tenant_id = $2
         ORDER BY a.project_id`,
        [userId, tenantId],
      );

      return result.rows.map((row) => row.project_id);
    },
  };
}
