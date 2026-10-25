
BEGIN;

-- Add authentication and tenant ownership without rewriting migration 001.
-- Existing projects are assigned to an explicit legacy tenant.
-- Super Admin creation is handled by a separate controlled bootstrap.

-- 1. Tenants
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenants_status_check
    CHECK (status IN ('active', 'suspended')),

  CONSTRAINT tenants_key_format_check
    CHECK (tenant_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),

  CONSTRAINT tenants_name_nonempty_check
    CHECK (length(btrim(name)) > 0)
);

-- 2. Users
-- password_hash must contain a securely generated password hash.
-- Never store plaintext passwords.
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_email_normalized_check
    CHECK (
      email = lower(btrim(email))
      AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),

  CONSTRAINT users_password_hash_length_check
    CHECK (length(password_hash) BETWEEN 20 AND 512),

  CONSTRAINT users_status_check
    CHECK (status IN ('active', 'disabled'))
);

-- 3. Tenant memberships
-- Super Admin is a platform-level privilege, not a tenant role.
CREATE TABLE public.tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenant_memberships_role_check
    CHECK (role IN ('admin', 'database_operator', 'viewer')),

  CONSTRAINT tenant_memberships_user_tenant_id_unique
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX idx_tenant_memberships_tenant_role
  ON public.tenant_memberships (tenant_id, role);

-- 4. Assign ownership to existing projects.
-- Backfill before enforcing NOT NULL so existing records are preserved.
INSERT INTO public.tenants (tenant_key, name)
VALUES ('legacy', 'Legacy Tenant (existing projects)');

ALTER TABLE public.projects
  ADD COLUMN tenant_id UUID;

UPDATE public.projects
SET tenant_id = (
  SELECT id
  FROM public.tenants
  WHERE tenant_key = 'legacy'
)
WHERE tenant_id IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN tenant_id SET NOT NULL,
  ADD CONSTRAINT projects_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT projects_id_tenant_id_unique
    UNIQUE (id, tenant_id);

CREATE INDEX idx_projects_tenant_created
  ON public.projects (tenant_id, created_at DESC);

-- 5. Project assignments.
-- Composite foreign keys prevent cross-tenant assignments.
CREATE TABLE public.project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_assignments_user_tenant_fkey
    FOREIGN KEY (user_id, tenant_id)
    REFERENCES public.tenant_memberships (user_id, tenant_id)
    ON DELETE CASCADE,

  CONSTRAINT project_assignments_project_tenant_fkey
    FOREIGN KEY (project_id, tenant_id)
    REFERENCES public.projects (id, tenant_id)
    ON DELETE CASCADE,

  CONSTRAINT project_assignments_user_project_unique
    UNIQUE (user_id, project_id)
);

CREATE INDEX idx_project_assignments_project
  ON public.project_assignments (project_id);

-- 6. Authentication sessions.
-- Store SHA-256 hashes of cryptographically random session tokens,
-- never the raw tokens. CSRF tokens must also be securely generated.
CREATE TABLE public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token_hash CHAR(64) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,

  user_agent TEXT,
  client_ip INET,

  CONSTRAINT auth_sessions_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT auth_sessions_csrf_hash_check
    CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT auth_sessions_expiry_check
    CHECK (expires_at > created_at),

  CONSTRAINT auth_sessions_last_seen_check
    CHECK (
      last_seen_at IS NULL
      OR (
        last_seen_at >= created_at
        AND last_seen_at <= expires_at
      )
    ),

  CONSTRAINT auth_sessions_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_user_expiry
  ON public.auth_sessions (user_id, expires_at DESC);

CREATE INDEX idx_auth_sessions_active_expiry
  ON public.auth_sessions (expires_at)
  WHERE revoked_at IS NULL;



-- Runtime application privileges.
-- This migration requires the separately provisioned runtime role.
DO $role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'ppm_registry_app'
  ) THEN
    RAISE EXCEPTION
      'Required application role ppm_registry_app does not exist';
  END IF;
END
$role_check$;

GRANT USAGE ON SCHEMA public TO ppm_registry_app;

-- Projects are created by the API but are not updated by a project-update
-- endpoint. The tenant ID is supplied by trusted server-side context.
REVOKE INSERT, UPDATE ON TABLE public.projects
  FROM ppm_registry_app, PUBLIC;

-- Also remove legacy column-level grants on existing project columns.
REVOKE INSERT (id, tenant_id, project_key, name, status, created_at),
        UPDATE (id, tenant_id, project_key, name, status, created_at)
  ON TABLE public.projects
  FROM ppm_registry_app, PUBLIC;

GRANT SELECT ON TABLE public.projects TO ppm_registry_app;

GRANT INSERT (id, tenant_id, project_key, name, status)
  ON TABLE public.projects TO ppm_registry_app;

-- Instance lifecycle changes are restricted to the status column.
REVOKE INSERT, UPDATE ON TABLE public.database_instances
  FROM ppm_registry_app, PUBLIC;

-- Also remove legacy column-level write grants.
REVOKE INSERT (
          id, project_id, environment, database_name,
          server_key, status, created_at
        ),
        UPDATE (
          id, project_id, environment, database_name,
          server_key, status, created_at
        )
  ON TABLE public.database_instances
  FROM ppm_registry_app, PUBLIC;

GRANT SELECT ON TABLE public.database_instances TO ppm_registry_app;

GRANT INSERT (
  id, project_id, environment, database_name, server_key, status
)
  ON TABLE public.database_instances TO ppm_registry_app;

GRANT UPDATE (status)
  ON TABLE public.database_instances TO ppm_registry_app;

-- The application can append audit events and obtain the inserted event ID.
-- It cannot read the complete audit history or edit existing audit records.
REVOKE ALL PRIVILEGES ON TABLE public.audit_events
  FROM ppm_registry_app, PUBLIC;

-- Remove legacy column-level access too, including access to audit history.
REVOKE SELECT (id, actor, action, target, outcome, details, created_at),
        INSERT (id, actor, action, target, outcome, details, created_at),
        UPDATE (id, actor, action, target, outcome, details, created_at),
        REFERENCES (id, actor, action, target, outcome, details, created_at)
  ON TABLE public.audit_events
  FROM ppm_registry_app, PUBLIC;

GRANT INSERT (id, actor, action, target, outcome, details)
  ON TABLE public.audit_events TO ppm_registry_app;

GRANT SELECT (id)
  ON TABLE public.audit_events TO ppm_registry_app;

-- Remove any owner-defined default table grants on the new authentication
-- and tenancy tables before granting only the access used by the API.
REVOKE ALL PRIVILEGES ON TABLE
  public.users,
  public.tenants,
  public.tenant_memberships,
  public.project_assignments,
  public.auth_sessions
  FROM ppm_registry_app, PUBLIC;

GRANT SELECT (id, email, password_hash, is_super_admin, status)
  ON TABLE public.users TO ppm_registry_app;

GRANT SELECT (id, tenant_key, name, status)
  ON TABLE public.tenants TO ppm_registry_app;

GRANT SELECT (tenant_id, user_id, role)
  ON TABLE public.tenant_memberships TO ppm_registry_app;

GRANT SELECT (project_id, user_id, tenant_id)
  ON TABLE public.project_assignments TO ppm_registry_app;

GRANT SELECT (
  id, user_id, token_hash, csrf_token_hash, expires_at,
  revoked_at, user_agent, client_ip
)
  ON TABLE public.auth_sessions TO ppm_registry_app;

GRANT INSERT (
  id, user_id, token_hash, csrf_token_hash, expires_at,
  user_agent, client_ip
)
  ON TABLE public.auth_sessions TO ppm_registry_app;

GRANT UPDATE (last_seen_at, revoked_at)
  ON TABLE public.auth_sessions TO ppm_registry_app;

COMMIT;
