# PostgreSQL Operations

## Purpose

Define the operational procedures for managing PostgreSQL servers and independent project databases.

## Operational Principles

- Maintain a separate database for each project and environment.
- Enforce least-privilege access.
- Use version-controlled migrations.
- Back up production databases and test restoration.
- Keep production credentials out of source control.
- Audit administrative operations.

## Database Lifecycle

1. Register the project.
2. Provision its database and roles.
3. Apply schema permissions.
4. Run version-controlled migrations.
5. Verify connectivity and application health.
6. Monitor performance, storage, and backups.
7. Retire the database only with explicit approval.

## Naming Convention

Examples:

- `ogwusearch_dev`
- `ogwusearch_prod`
- `solar_audit_dev`
- `solar_audit_prod`
- `resort_platform_dev`
- `resort_platform_prod`
- `platform_control_db`

Use lowercase names and underscores.

## Access Management

Maintain separate roles for application runtime, migrations, backups, monitoring, and administration.

Application roles must not have unnecessary schema modification or server administration privileges. Administrative credentials must never be exposed to the web interface.

Store credentials in a secure secret manager or protected configuration. Never commit production passwords.

## Migration Procedures

1. Review and test migrations in development.
2. Run schema and application tests.
3. Verify recoverable backups before risky production changes.
4. Obtain required production approval.
5. Apply the migration to the intended database.
6. Verify schema state and application health.
7. Record the migration outcome.

Do not automatically run production migrations on application startup.

## Backup Procedures

- Schedule regular production database backups.
- Store encrypted backup copies outside the PostgreSQL host.
- Use physical backups and WAL archiving when point-in-time recovery is required.
- Record backup timestamps, locations, checksums, and outcomes.
- Test restoration in an isolated environment.

Initial retention targets may include daily backups for 7–14 days and weekly backups for 4–8 weeks. Adjust these to business requirements.

## Monitoring

Monitor server availability, database connections, connection limits, storage, query performance, locks, migration failures, backup freshness, and authentication failures.

Configure alerts based on observed workloads and documented operational thresholds.

## Incident Response

1. Identify the affected server and project.
2. Determine the type and scope of failure.
3. Preserve relevant logs.
4. Avoid destructive actions until the cause is understood.
5. Follow the recovery procedure.
6. Verify integrity and application functionality.
7. Document the incident and preventive measures.

## Database Retirement

Require explicit approval before retirement. Check dependencies, revoke application access, verify the final backup, confirm retention obligations, update the registry, and audit the operation.

## Operational Checklist

- [ ] PostgreSQL is healthy.
- [ ] Database and environment are correct.
- [ ] Roles follow least privilege.
- [ ] Credentials are stored securely.
- [ ] Migrations are version-controlled.
- [ ] Production changes are approved.
- [ ] Backups succeed and exist off-host.
- [ ] Restoration has been tested.
- [ ] Monitoring and alerts work.
- [ ] Administrative operations are audited.

## Related Documentation

- Architecture: ../architecture/README.md
- Security: ../security/README.md
- Disaster recovery: ../disaster-recovery/README.md
- PostgreSQL infrastructure: ../../infrastructure/postgres/README.md
- Backup infrastructure: ../../infrastructure/backups/README.md
- Monitoring infrastructure: ../../infrastructure/monitoring/README.md

## Maintenance

Review this document whenever database architecture, permissions, backup policies, recovery objectives, or deployment procedures change.
