# PPM Operations Pages

## Scope

These pages use authenticated, tenant-scoped API data. Migrations and Backups
show history only. Monitoring reports control-database readiness and recorded
instance lifecycle counts; it does not continuously probe target databases.
Audit log displays scoped audit events. Users & access is a read-only workspace
membership directory. Settings reports current account and workspace context;
persistent editable settings are not implemented.

## Read-only API contracts

- `GET /api/migration-runs?limit=50&offset=0`: migration history for projects
  in the selected tenant and accessible project set.
- `GET /api/backup-runs?limit=50&offset=0`: backup history and safe metadata;
  the raw backup location is never returned.
- `GET /api/monitoring`: control database check and registered instance counts;
  `target_connections` is `not_probed`.
- `GET /api/audit-events?limit=50&offset=0`: recent audit events scoped through
  project and database-instance targets.
- `GET /api/users?limit=50&offset=0`: tenant membership directory for workspace
  administrators and Super Admins. Password hashes are not selected.
- `GET /api/settings`: authenticated account and selected tenant context.

The API requires an authenticated session and selected `X-Tenant-Id`; other
methods fail closed. Pagination limits are 1–100 rows.

## Required runtime permissions

`database/control-migrations/003_operations_read_permissions.sql` adds read-only
column privileges to `ppm_registry_app` for migration history, backup metadata,
and audit details. This migration is deliberately not run by the UI patch. Review
and authorize its application separately using the protected migration procedure.
Do not run destructive test setup or reset operations against
`platform_control_db`.
