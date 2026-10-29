BEGIN;

-- Read-only permissions for the tenant-scoped operations APIs.
-- Queries must continue to scope every result through the authenticated
-- tenant's projects and authorized project IDs. No write privileges are added.

DO $role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'ppm_registry_app'
  ) THEN
    RAISE EXCEPTION
      'Required application role ppm_registry_app does not exist';
  END IF;
END
$role_check$;

GRANT SELECT (
  id, database_instance_id, migration_version, status, started_at, finished_at
)
  ON TABLE public.migration_runs TO ppm_registry_app;

GRANT SELECT (
  id, database_instance_id, checksum_sha256, status, started_at,
  finished_at, restore_tested_at, backup_location
)
  ON TABLE public.backup_runs TO ppm_registry_app;

-- Migration 002 deliberately granted only SELECT(id) on audit_events.
-- Permit the API to read the metadata needed for a scoped audit view.
GRANT SELECT (
  id, actor, action, target, outcome, details, created_at
)
  ON TABLE public.audit_events TO ppm_registry_app;

COMMIT;
