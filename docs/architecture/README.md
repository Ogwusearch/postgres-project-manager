# PostgreSQL Project Manager — Architecture

## 1. Purpose

The PostgreSQL Project Manager provides a centralized way to manage
independent project databases, access permissions, schema migrations,
backups, monitoring, and administrative audit records.

Each project owns a separate database for each environment.

## 2. Architecture Principles

- One PostgreSQL server can host multiple project databases.
- Each project has a stable project identifier.
- Development, staging, and production databases are separate.
- Application credentials are isolated by project.
- Schema changes are managed through versioned migrations.
- Database administration is performed through controlled operations.
- Backups are stored independently of the PostgreSQL server.
- Administrative actions are recorded for auditing.
- Secrets must never be committed to source control.
- Production operations require authorization and verification.

## 3. High-Level Architecture

    Admin Dashboard
          |
          v
    Database Management API
          |
          +---------------------+
          |                     |
          v                     v
    Control Registry      PostgreSQL Administration
    platform_control_db         |
                                +-- ogwusearch_dev
                                +-- ogwusearch_prod
                                +-- solar_audit_dev
                                +-- solar_audit_prod
                                +-- resort_platform_dev
                                +-- resort_platform_prod
          |
          v
    Audit and Operations Records

    PostgreSQL Backups
          |
          v
    Independent Backup Storage

The diagram represents logical responsibilities. The control registry
and project databases may initially run on the same PostgreSQL server.

## 4. Main Components

### Admin Dashboard

Provides project listings, database status, migration history,
backup status, and authorized administrative actions.

The dashboard must not connect directly using a PostgreSQL
superuser account.

### Database Management API

Coordinates approved database-management operations.

Responsibilities:

- Register projects.
- Provision project databases.
- Configure project-specific roles and grants.
- Run approved migrations.
- Schedule and report backups.
- Check database health.
- Record administrative audit events.

The API must validate all project identifiers and operation parameters.
It must not accept arbitrary SQL from untrusted clients.

### Control Registry

The platform_control_db database stores management metadata.

Core tables:

- projects
- database_instances
- migration_runs
- backup_runs
- audit_events

The registry stores database identifiers and operational metadata,
not plaintext database passwords.

### Project Databases

Each project has its own database and environment-specific credentials.

Examples:

- ogwusearch_dev
- ogwusearch_prod
- solar_audit_dev
- solar_audit_prod
- resort_platform_dev
- resort_platform_prod

Project application tables belong in their respective project databases,
not in the control registry.

### Migration Runner

Applies versioned schema changes to the intended database.

Every migration run must record the target database, migration version,
execution status, timestamps, and failure summary when applicable.

Production migrations should require an approved release workflow.

### Backup Manager

Creates database backups, verifies backup artifacts, enforces retention,
and coordinates off-host storage and restore tests.

A successful backup job does not by itself prove recoverability.
Restores must be tested independently.

### Audit Logging

Records administrative actions, including database provisioning,
permission changes, migration executions, backup operations,
and restore attempts.

Audit records should identify the actor, action, target, outcome,
and timestamp without exposing credentials or sensitive data.

## 5. Database Naming Convention

Use lowercase names with underscores.

Recommended format:

    <project_key>_<environment>

Examples:

    solar_audit_dev
    solar_audit_staging
    solar_audit_prod

Allowed environments:

- dev
- staging
- prod

Use stable project keys and maintain a mapping to full project names
in the control registry.

Database names must be validated before provisioning.

## 6. Access Control Model

Use separate PostgreSQL roles for separate responsibilities.

### Platform Administrator

Creates databases and roles and manages approved administrative
operations. Administrative credentials must be tightly controlled.

### Database Owner

A non-login role that owns a project's database or application schema.

### Migration Role

Applies schema changes for its assigned project. It must not administer
unrelated project databases.

### Application Role

Has only the data-access permissions required by the application.
It should not create databases, manage roles, or modify schemas.

### Read-Only Role

Supports authorized reporting and inspection without data modification.

### Backup and Monitoring Roles

Receive only the permissions required for their specific operations.

Project credentials must not be reused across unrelated projects.
Database separation must be reinforced with role grants and connection
restrictions.

## 7. Migration Lifecycle

1. Develop a versioned migration.
2. Review the migration and its rollback or recovery strategy.
3. Apply it to the development database.
4. Run schema and application tests.
5. Approve the production release.
6. Verify backup and recovery readiness when appropriate.
7. Apply the migration to the intended production database.
8. Verify the final schema version and application health.
9. Record the outcome in the control registry.

Avoid destructive schema changes without a documented recovery plan.
Prefer backward-compatible changes for applications that deploy
independently of database migrations.

## 8. Backup and Recovery

The backup system should support:

- Logical backups for individual project databases.
- Global role and permission definitions backed up separately.
- Physical backups for cluster-level recovery where required.
- WAL archiving and point-in-time recovery where required.
- Encrypted copies in independent storage.
- Configurable retention policies.
- Backup integrity checks.
- Periodic restoration tests.

Backup retention, recovery point objectives (RPO), and recovery time
objectives (RTO) must be defined for each production project.

Never rely exclusively on backups stored on the database host.

## 9. Security Boundaries

Separate databases provide logical separation, but databases hosted
on one PostgreSQL server still share server resources and availability.

Required controls:

- Restrict network access to PostgreSQL.
- Use secure authentication and TLS where appropriate.
- Protect administrative credentials.
- Keep secrets out of source control and logs.
- Apply least-privilege grants.
- Validate all management API inputs.
- Audit privileged operations.
- Limit connection counts and resource consumption.
- Test access using actual project application credentials.
- Review database and role permissions regularly.

Projects requiring stronger availability, performance, or security
isolation may be moved to separate PostgreSQL instances.

## 10. Implementation Phases

### Phase 1 — PostgreSQL Foundation

Configure PostgreSQL, administrative access, network boundaries,
and environment separation.

### Phase 2 — Control Registry

Create platform_control_db and apply the initial registry migration.

### Phase 3 — Database Provisioning

Automate project database creation, role creation, grants,
and connection configuration.

### Phase 4 — Migration Management

Implement controlled migration execution and migration history.

### Phase 5 — Backup and Recovery

Automate backups, independent storage, retention, and restore tests.

### Phase 6 — Monitoring

Add database health checks, backup alerts, connection metrics,
and operational status reporting.

### Phase 7 — Administration Interface

Connect the dashboard to the management API with authorization,
audit logging, and production approval controls.

## 11. Initial Acceptance Criteria

The architecture foundation is ready when:

- The control registry migration applies successfully.
- A project can be registered with a stable identifier.
- A development database can be provisioned.
- The application role cannot administer the database.
- Project credentials cannot access unrelated project data.
- A migration can be applied and its result recorded.
- A logical backup can be created and restored to a test database.
- Administrative actions produce audit records.
- No plaintext production secrets are committed to the repository.

## 12. Architectural Decision

Start with one PostgreSQL server hosting multiple independent project
databases, with strict role separation and environment-specific names.

Introduce additional PostgreSQL instances when workload, security,
availability, or recovery requirements justify the operational cost.
