# @postgres-project-manager/backup-manager

Database-independent contracts for managing database backups.

## Responsibilities

- Define backup request and artifact types.
- Define the provider interface for backup creation and verification.
- Validate backup requests and retention policies.
- Describe retention requirements without executing deletion.

## Security boundaries

- Resolve database-instance identifiers and database names using trusted
  server-side records, not untrusted request-body fields.
- Authorize backup operations in the calling application.
- Keep credentials, connection strings, secret values, and command arguments
  containing secrets out of backup metadata and error messages.
- Treat storage references as internal values; do not expose them directly
  in API responses.
- Do not restore a backup without a separately authorized, validated restore
  workflow.

## Retention

The retention policy is a contract only. This package does not delete
artifacts. A future cleanup service must protect required backups, require
verification as configured, authorize deletion, and audit cleanup operations.

## Persistence and provider integration

No PostgreSQL process execution or storage adapter is included yet. Before
implementing one, inspect the existing database-instance model, secret
handling, backup destination configuration, and operational recovery policy.
Use the platform's established resource identifiers and authorization model.

## Development

From the repository root:

    pnpm --filter @postgres-project-manager/backup-manager test
    pnpm --filter @postgres-project-manager/backup-manager typecheck
    pnpm --filter @postgres-project-manager/backup-manager build
