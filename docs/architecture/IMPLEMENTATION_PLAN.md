# Implementation Plan

## Initial vertical slice

Implement one complete workflow before expanding functionality:

1. Verify PostgreSQL connectivity.
2. Connect to the administrative database.
3. Create platform_control_db if authorized and absent.
4. Apply database/control-migrations/001_initial_registry.sql.
5. Verify all registry tables.
6. Register a development project.
7. Provision its database using a controlled service.
8. Apply and verify a project migration.
9. Back up and restore the project database.
10. Record operation outcomes.

## Package boundaries

### project-registry
Owns project and database metadata contracts and queries.

### postgres-admin
Owns validated PostgreSQL administration operations.
Must not accept arbitrary SQL from HTTP clients.

### migration-runner
Owns migration discovery, ordering, execution, and status recording.

### backup-manager
Owns backup execution, checksum verification, retention, and restore checks.

### access-control
Owns authentication integration and operation authorization.

### audit-logging
Owns structured security and administrative event records.

### database-api
Coordinates services and exposes validated endpoints.

### admin-web
Displays project, database, migration, backup, and health information.

## Engineering rules

- Keep control-plane data separate from project application data.
- Never expose administrative credentials to the browser.
- Use parameterized SQL for data queries.
- Validate all identifiers before administrative operations.
- Use explicit transactions where supported.
- Treat destructive operations as privileged actions.
- Do not automatically run production migrations at startup.
- Test permission boundaries with real PostgreSQL roles.
- Add tests before expanding each service.

## Initial acceptance tests

- PostgreSQL health check succeeds.
- Control registry migration applies successfully.
- Reapplying a completed migration is safely prevented or handled.
- Required tables and indexes exist.
- Application credentials cannot create databases or roles.
- Project credentials cannot access unrelated project data.
