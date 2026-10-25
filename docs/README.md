# PostgreSQL Project Manager

**A multi-tenant PostgreSQL database management platform for registering projects, managing environment-specific databases, provisioning development databases, and tracking database operations.**

## 1. Project Overview

PostgreSQL Project Manager (PPM) is a backend platform for managing PostgreSQL databases across multiple projects and environments.

The system is designed around a central control database that stores project registrations, database instance metadata, migration execution history, backup history, and audit events.

Each registered project can have separate database instances for:

- Development
- Staging
- Production

The platform separates its own control-plane database from the PostgreSQL databases it manages. This separation provides a foundation for controlled provisioning, verification, migrations, backups, and operational auditing.

### Core principles

- **Control plane first:** establish a reliable registry before expanding database operations.
- **Explicit operations:** provisioning and migrations must be deliberate, validated actions.
- **Least privilege:** application credentials should have only the permissions required for their responsibilities.
- **No silent adoption:** an existing target database must not be treated as a newly provisioned project database without an explicit adoption workflow.
- **Auditable lifecycle:** operational actions should record their outcomes.
- **Fail safely:** uncertain database state must stop an operation rather than trigger destructive recovery.
- **Test before production:** database changes must be tested against disposable PostgreSQL instances before they are applied to important databases.

## 2. Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| HTTP API | Fastify |
| Database driver | `pg` |
| Configuration | `dotenv` |
| Input validation | Zod |
| Control database | PostgreSQL |
| Unit and API tests | Node.js test runner through `tsx` |
| Type checking | TypeScript compiler |
| Build | TypeScript compiler |
| Database environment | Docker-based PostgreSQL instances |

The project uses a lightweight TypeScript backend rather than requiring a large application framework.

## 3. Architecture

The platform is organized into four main responsibility areas.

### 3.1 Control plane

The control plane manages the registry and operational metadata for all registered projects.

Its responsibilities include:

- Project registration and lifecycle.
- Database instance registration.
- Environment identification.
- Provisioning and verification status.
- Migration execution records.
- Backup execution records.
- Audit event storage.

The control database is not intended to store every application's business data.

### 3.2 Project databases

Each project database is a separate PostgreSQL database associated with a registered project and environment.

For example:

```text
Project: analytics-service
├── Development database
├── Staging database
└── Production database
```

The actual databases are managed separately from the control database. The control plane records their identity, environment, status, and operational history.

### 3.3 Application API

The Fastify API provides the interface for managing projects and their database instances.

The API validates incoming requests and coordinates operations through dedicated services.

Database provisioning, connection verification, and lifecycle transitions should remain separate operations with explicit outcomes.

### 3.4 Operational tooling

Operational tooling performs tasks that should not happen automatically during ordinary API startup, including:

- Control schema migrations.
- Target database migrations.
- Database provisioning.
- Backup creation and verification.
- Restore testing.
- Operational recovery.

This separation helps prevent routine API startup from unexpectedly modifying database schemas or creating databases.

## 4. Current Repository Structure

The following represents the established project areas and the current implementation direction. Some future directories may still need to be created.

```text
postgres-project-manager/
├── apps/
│   └── admin-web/
│
├── database/
│   └── control-migrations/
│       └── 001_initial_registry.sql
│
├── scripts/
│   ├── control-migrations.mjs
│   └── control-migrations-lib.mjs
│
├── src/
│   ├── server.ts
│   ├── routes/
│   ├── services/
│   ├── database/
│   └── ...
│
├── tests/
│   ├── app.test.ts
│   ├── database-connection-verifier.test.ts
│   ├── secret-store.test.ts
│   ├── control-migrations.test.ts
│   └── integration/
│       ├── atomic-verification.test.ts
│       └── concurrent-verification.test.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

**Note:** The tree describes known project areas and the intended organization. Confirm the actual route and service filenames before treating the illustrative subdirectories as an exact file listing.

## 5. Control Database Schema

The initial registry migration is:

`database/control-migrations/001_initial_registry.sql`

It creates five tables.

### 5.1 `projects`

Stores registered projects.

Key fields:

- `id` — project UUID.
- `project_key` — unique project identifier.
- `name` — project display name.
- `status` — active, inactive, or archived.
- `created_at` — registration timestamp.

### 5.2 `database_instances`

Stores database registrations for each project and environment.

Key fields:

- `id` — database instance UUID.
- `project_id` — associated project.
- `environment` — development, staging, or production.
- `database_name` — unique database name.
- `server_key` — identifier for the database server configuration.
- `status` — planned, provisioning, ready, failed, or retired.
- `created_at` — registration timestamp.

A unique constraint prevents duplicate database registrations for the same project and environment.

### 5.3 `migration_runs`

Tracks individual project-database migration executions.

It records the database instance, migration version, execution status, start and finish timestamps, and a safe error summary.

This table is for **project database migration runs**. It is distinct from the control schema migration history that records changes to the platform's own control database.

### 5.4 `backup_runs`

Tracks backup operations and their verification state.

It includes backup location, SHA-256 checksum, execution status, timestamps, and the time a restore test was performed.

A recorded backup is not automatically considered restorable; restore testing must be implemented and performed separately.

### 5.5 `audit_events`

Records operational actions and their outcomes.

Fields include actor, action, target, outcome, JSON details, and creation timestamp.

Audit records help explain what happened during provisioning, verification, and other database operations.

### Indexes and constraints

The initial migration defines primary keys, uniqueness constraints, foreign keys, status checks, environment checks, and indexes for project lookup and chronological operational history.

The migration file is the schema baseline and should not be casually edited after it has been applied to a database.

## 6. Implemented Foundation

The following items have been established and verified during development.

### 6.1 Project registration

- Register projects.
- Validate project creation input.
- Reject duplicate project keys.
- Support project pagination with validation.

### 6.2 Database instance registration

- Register database instances for existing projects.
- Validate environment values.
- Reject client-controlled lifecycle status.
- Reject registration against nonexistent projects.
- Reject duplicate database names.
- List database instances for a project.

### 6.3 Connection verification

- Verify registered database connections.
- Transition a planned instance to ready after successful verification.
- Record failed verification outcomes.
- Record audit events for verification failures.
- Validate database instance identifiers.
- Test consistency between lifecycle status and audit outcomes.
- Test atomic and concurrent verification behavior.

### 6.4 Development database provisioning

The provisioning foundation includes:

- Provisioning a planned development database.
- Recording successful provisioning and audit outcomes.
- Rejecting staging and production provisioning through the restricted development workflow.
- Refusing to adopt an already-existing target database.
- Recording failed provisioning.
- Preventing a second request from invoking provisioning again.
- Avoiding automatic retries when finalization fails.
- Avoiding false success claims when configuration fails.

Production provisioning and recovery workflows require additional authorization, safeguards, and testing.

### 6.5 Secret storage

The secret-store foundation includes:

- Storing and reading secrets through references.
- Preventing secret values from being exposed in references.
- Rejecting duplicate secret creation.
- Rejecting empty values and unsafe references.
- Detecting symlink-related path risks.
- Restricting directory permissions.
- Cleaning up partially written secrets when a write fails.

Secret rotation, external secret managers, and broader production credential policies remain future work unless separately implemented.

## 7. Control Schema Migration Runner

A dedicated migration runner has been created in:

- `scripts/control-migrations.mjs`
- `scripts/control-migrations-lib.mjs`
- `tests/control-migrations.test.ts`

The runner is intended to manage changes to the control database schema independently of application startup.

### Current capabilities

- Discover SQL migration files.
- Validate migration filenames.
- Sort migrations by numeric version.
- Reject duplicate migration versions.
- Calculate SHA-256 checksums.
- Remove the outer transaction wrapper from a migration when needed, while preserving the SQL statement terminators.
- Use a dedicated PostgreSQL client.
- Acquire a session-level advisory lock.
- Apply a migration and record its history within a transaction.
- Detect recorded migrations whose filenames or checksums no longer match.
- Require an explicit `--baseline-existing` option before baselining a recognized existing registry schema.
- Avoid executing the initial schema migration when baselining an existing registry.
- Keep migration credentials separate from ordinary application and provisioning credentials.

### Migration history

The planned control migration history table is:

`public.control_schema_migrations`

It records:

- Migration version.
- Migration filename.
- SHA-256 checksum.
- Application timestamp.

This table serves a different purpose from `migration_runs`.

### Existing-database baseline

The runner is designed to support an existing registry database without re-executing the initial schema migration.

Baselining must only occur after confirming that the existing schema matches the expected migration baseline.

**Important:** The baseline verifier currently checks several structural properties, including table names, column types, nullability, index names, constraint names, selected defaults, and check-constraint values. These checks do not yet constitute a complete comparison of every PostgreSQL object definition.

The migration runner must not be considered production-ready until schema verification and migration-history integrity have been strengthened and tested against disposable databases.

## 8. Database and Credential Separation

The development environment uses separate PostgreSQL instances for different responsibilities.

| Component | Database or instance | Host port |
|---|---|---:|
| Control plane | `platform_control_db` | `55433` |
| Development database provisioning server | `ppm-provision-dev-postgres` | `55434` |

The control PostgreSQL container is named `ppm-control-postgres`.

The application registry role is `ppm_registry_app`. It is intentionally restricted and should not receive superuser or database-creation privileges.

The existing control database also has an administrative role, `ppm_control_admin`. Its elevated privileges make it unsuitable as the default application credential.

### Migration configuration

The runner expects these environment variables:

```dotenv
CONTROL_MIGRATION_HOST=
CONTROL_MIGRATION_PORT=55433
CONTROL_MIGRATION_DATABASE=
CONTROL_MIGRATION_USER=
CONTROL_MIGRATION_PASSWORD=
```

The values must be supplied through a protected environment or local environment file that is excluded from version control.

Do not commit credentials, print secrets in logs, or reuse application credentials as migration credentials without an explicit privilege review.

## 9. Testing and Validation

The project uses automated tests to validate behavior and prevent regressions.

The latest confirmed local validation run reported:

| Check | Result |
|---|---|
| Unit and API tests | 70 passed |
| Application integration tests | 2 passed |
| TypeScript typecheck | Passed |
| TypeScript build | Passed |
| Runner JavaScript syntax checks | Passed |
| Whitespace checks | Passed |

The application integration tests cover verification atomicity and concurrency; they do not exercise the full control-migration runner lifecycle. The runner was also manually exercised against the dedicated test database `ppm_test_control_runner_20261018`: migration `001` applied, and a subsequent run reported it was already applied.

Automated disposable-PostgreSQL integration coverage for the control-migration lifecycle, including rollback, baseline refusal, checksum drift, history corruption, and concurrent runner execution, remains outstanding.

These results do not establish that `platform_control_db` has been migrated or baselined. That database remains protected.

### Testing layers

1. **Unit tests:** validate parsing, state classification, checksums, and other deterministic behavior.
2. **API tests:** validate request handling, lifecycle transitions, and error handling.
3. **Integration tests:** validate atomicity and concurrent operations.
4. **Disposable PostgreSQL tests:** must validate real migration application, rollback, baseline, checksum mismatch, and history integrity.
5. **Production-readiness checks:** must verify permissions, backups, restore procedures, recovery behavior, and operational monitoring.

## 10. Next Implementation Roadmap

Implementation should proceed in the following order.

### Phase 1 — Harden the control migration runner

**Priority: immediate**

- [ ] Validate the actual structure of `control_schema_migrations`.
- [ ] Reject empty history when registry tables already exist.
- [ ] Require migration `001` to be present in tracked databases.
- [ ] Reject gaps in recorded migration history.
- [ ] Reject unknown migration versions and filename/checksum mismatches.
- [ ] Strengthen schema verification to compare complete index, constraint, foreign-key, and default definitions.
- [ ] Detect unexpected public-schema objects, including views and other relevant relations.
- [ ] Add regression tests for each failure state.
- [ ] Verify that migration failures roll back both schema changes and history records.

The history-integrity checks are implemented and unit-tested. Full disposable-PostgreSQL integration coverage for the control-migration lifecycle remains outstanding.

### Phase 2 — Disposable PostgreSQL migration integration tests

**Priority: immediate after Phase 1**

- [ ] Create a disposable empty control database.
- [ ] Apply migration `001`.
- [ ] Confirm the expected tables, indexes, constraints, and migration history.
- [ ] Run the runner again and confirm it is idempotent.
- [ ] Change a migration file in a test copy and confirm checksum mismatch is rejected.
- [ ] Simulate a failing migration and confirm transactional rollback.
- [ ] Test an existing schema with no history.
- [ ] Test a matching baseline without re-executing migration `001`.
- [ ] Test a mismatched schema and confirm baselining is refused.
- [ ] Test empty, incomplete, gapped, and inconsistent migration histories.

Use a disposable PostgreSQL database for these tests. Do not run migration `001` against the existing `platform_control_db`, because its registry tables already exist.

### Phase 3 — Dedicated migration permissions

- [ ] Define the privileges required for control schema migrations.
- [ ] Create or configure a dedicated non-superuser migration role.
- [ ] Ensure the role can perform required schema changes without granting unnecessary cluster-wide privileges.
- [ ] Test grants and ownership against a disposable database.
- [ ] Keep the restricted API role separate from the migration role.
- [ ] Document credential provisioning and rotation.

### Phase 4 — Control database baseline

Only after the earlier phases pass:

- [ ] Inspect the existing control database schema.
- [ ] Compare it against migration `001`.
- [ ] Verify the tracking table is absent or in a safe, explicitly handled state.
- [ ] Confirm a protected backup or recovery procedure exists.
- [ ] Baseline the existing database using the dedicated migration credential.
- [ ] Verify the recorded checksum matches the immutable migration file.
- [ ] Rerun the runner and confirm it reports that the database is up to date.

### Phase 5 — Project database migration service

- [ ] Define migration execution contracts for project databases.
- [ ] Track per-database migration status in `migration_runs`.
- [ ] Validate target database identity before executing migrations.
- [ ] Define timeouts and safe error summaries.
- [ ] Handle concurrent requests and duplicate execution.
- [ ] Define failed-migration recovery procedures.
- [ ] Test migration execution against disposable project databases.

### Phase 6 — Backup and restore management

- [ ] Implement backup execution and metadata recording.
- [ ] Calculate and verify SHA-256 checksums.
- [ ] Track backup failures and incomplete runs.
- [ ] Implement isolated restore testing.
- [ ] Record restore-test outcomes.
- [ ] Define backup retention and cleanup policies.
- [ ] Document disaster-recovery procedures.

A backup should not be treated as verified merely because a backup command returned success.

### Phase 7 — Multi-tenant administration

- [ ] Define tenant and project authorization boundaries.
- [ ] Add authenticated administrative access.
- [ ] Enforce authorization for project and database operations.
- [ ] Prevent cross-project access.
- [ ] Protect sensitive operational metadata.
- [ ] Add audit actor identity and authorization outcomes.
- [ ] Establish rate limits and operational safeguards.

Multi-tenant database registration alone does not establish complete tenant isolation. Authorization and access-control testing are essential.

### Phase 8 — Admin dashboard

- [ ] Connect `apps/admin-web` to the API.
- [ ] Display projects and their database instances.
- [ ] Show environment and lifecycle status.
- [ ] Display migration and backup history.
- [ ] Surface verification failures and recovery requirements.
- [ ] Require confirmation for sensitive operations.
- [ ] Avoid presenting placeholder operational data as live database state.

### Phase 9 — Production readiness

- [ ] Implement structured logging and health checks.
- [ ] Define metrics and operational alerts.
- [ ] Review network access and TLS requirements.
- [ ] Establish database credential rotation.
- [ ] Test restore and disaster-recovery procedures.
- [ ] Review least-privilege access.
- [ ] Run security and concurrency tests.
- [ ] Document deployment, upgrades, rollback limitations, and incident response.

## 11. Development Commands

The repository currently uses these core commands:

```bash
# Run unit and API tests
pnpm test

# Check TypeScript without emitting files
pnpm typecheck

# Build TypeScript
pnpm build

# Start the development server
pnpm dev

# Check whitespace and patch formatting
git diff --check
```

The migration runner is intended to be invoked through the dedicated package script:

```bash
pnpm db:migrate:control
```

Baselining an existing registry requires explicit intent:

```bash
pnpm db:migrate:control -- --baseline-existing
```

**Do not run either migration command against the existing control database until the history-integrity safeguards, schema verification, permissions, and disposable PostgreSQL integration tests are complete.**

## 12. Definition of Done

A phase is complete only when:

- Its implementation matches the intended architecture.
- Input validation and failure behavior are covered by tests.
- Typechecking and build pass.
- Regression tests pass.
- Database-dependent behavior has been tested against PostgreSQL when applicable.
- Privileges and side effects have been reviewed.
- Documentation accurately reflects implemented behavior.
- The working tree has been inspected before committing.

A successful TypeScript build is not proof that a database operation is safe.

## 13. Project Status Summary

The project has established a working foundation for project registration, database instance management, connection verification, controlled development provisioning, audit recording, and secret storage.

The control database migration runner has been drafted and passes its current syntax checks, unit tests, typecheck, and build in the last confirmed run.

The immediate engineering priority is to strengthen migration-history and schema verification, then validate the complete migration lifecycle against disposable PostgreSQL databases.

The guiding principle remains:

**Build reliable database infrastructure first. Expand operational capabilities only after the underlying lifecycle, permissions, recovery, and verification guarantees have been tested.**


## Migration-runner safety checks

The control migration runner includes the following safeguards; the status of
these checks must be confirmed by running the test commands below on the current
worktree:

- Fresh initialization inspects objects in PostgreSQL's `public` schema and
  refuses to proceed when unrelated relations, routines, types, operators,
  conversions, collations, or text-search objects are found.
- Explicit baseline verification compares registry columns, index names,
  defaults, and complete rendered constraint definitions, including foreign
  keys and check constraints.
- Initial schema creation and insertion of its migration-history row occur in
  the same transaction. A failed initial migration should roll back both.
- Unit tests cover the public-schema guard and constraint-definition validator.
- Integration-test results apply only to the specific disposable database and
  PostgreSQL instance used for that run. They are not evidence that the
  production control database has been migrated or baselined.
- `platform_control_db` must not be used for migration-runner or baseline tests.

Before treating the runner as production-ready, run the unit tests, typecheck,
build, and integration tests; inspect the complete Git diff (including
untracked files); and separately review operational permissions, backup and
restore procedures, and deployment controls.



## Multi-Tenant User Interface

PostgreSQL Project Manager uses a shared web application for all user types. The interface adapts its navigation, accessible pages, data, and available actions according to the authenticated user's role, tenant membership, project assignments, and effective permissions.

The platform does not require a separate frontend application for each role.

### User Types

| Role | Scope | Responsibilities |
|---|---|---|
| Super Admin | Platform-wide | Manage tenants, platform access, and platform operations |
| Tenant Admin | Assigned tenant | Manage tenant users, projects, memberships, and database registrations |
| Database Operator | Assigned projects | Perform authorized database verification and operational tasks |
| Viewer | Assigned projects | Read permitted project, database, monitoring, and history information |

These roles describe the intended access model. Actual capabilities must be enforced by backend authorization rules.

### Shared Application Navigation

The shared application may include the following sections:

- **Dashboard:** Overview of authorized projects, database status, and operational activity.
- **Tenants:** Platform tenant management, available to Super Admins.
- **Projects:** Project registration, details, and project assignments.
- **Database Instances:** Environment-specific database registrations and lifecycle status.
- **Monitoring:** Database connectivity and operational status.
- **Migrations:** Migration execution history and outcomes.
- **Backups:** Backup history, checksums, and restore-test status.
- **Users & Access:** Tenant memberships, user administration, and project assignments.
- **Audit Log:** Authorized audit-event history.
- **Settings:** Role-appropriate tenant or platform settings.

Navigation entries are displayed according to the authenticated user's effective permissions. A visible navigation item or enabled button does not itself grant access.

### Frontend Organization

The existing `apps/admin-web/` directory is the intended location for the administrative frontend. The following structure is a proposed organization to introduce incrementally; it is not a claim that every directory or feature already exists.

```text
apps/admin-web/
└── src/
    ├── app/
    │   ├── router.tsx
    │   └── providers.tsx
    ├── layouts/
    │   ├── AuthLayout.tsx
    │   └── DashboardLayout.tsx
    ├── components/
    │   ├── ui/
    │   ├── navigation/
    │   └── feedback/
    ├── features/
    │   ├── auth/
    │   ├── dashboard/
    │   ├── tenants/
    │   ├── users/
    │   ├── projects/
    │   ├── database-instances/
    │   ├── monitoring/
    │   ├── migrations/
    │   ├── backups/
    │   └── audit/
    ├── hooks/
    ├── lib/
    │   ├── api-client.ts
    │   └── permissions.ts
    └── styles/
```

The frontend should consume the existing Fastify API rather than duplicate business logic or database authorization.

### Frontend Security Requirements

- Use the existing session-based authentication model.
- Preserve CSRF protection for state-changing requests.
- Validate tenant selection and membership on the server.
- Restrict project and database data to the user's authorized scope.
- Enforce permissions on every protected API operation.
- Do not expose database passwords, session tokens, or internal connection details.
- Require appropriate confirmation and authorization for sensitive operations.

Frontend permission checks improve usability, but they must never replace server-side authorization.

### UI Implementation Roadmap

1. Inspect the existing `apps/admin-web/` implementation and workspace configuration.
2. Establish the login page and shared authenticated application layout.
3. Integrate the current-user and logout endpoints.
4. Build the dashboard using real API data.
5. Implement project and database instance screens.
6. Add role-aware navigation and action controls.
7. Integrate monitoring, migration history, and backup history as their backend capabilities become available.
8. Implement tenant and user administration.
9. Add frontend tests for loading states, errors, authorization-dependent rendering, and session expiry.

Frontend features should be documented as implemented only after their actual code, API integration, and tests have been verified.
