# Development Roadmap

## Mission

Build a centralized PostgreSQL management platform for independent
projects and environments, using one database per project and environment.

## Architecture

- Admin Web: React and TypeScript.
- Management API: TypeScript.
- Control Registry: PostgreSQL.
- Project Data: independent PostgreSQL databases.
- Migrations: version-controlled and explicitly executed.
- Backups: PostgreSQL-aware tools and protected storage.
- Security: least privilege and audited administrative operations.

## Phase 01 — Foundation

Tasks:
- Establish repository conventions.
- Verify PostgreSQL client and server connectivity.
- Configure environment variables and secret handling.
- Create platform_control_db.
- Apply the initial registry migration.
- Verify migration results and connectivity.

Exit criteria:
- PostgreSQL is reachable.
- Control database exists.
- Registry tables exist.
- Migration execution is repeatable.
- Credentials are not committed.

## Phase 02 — Project Registry and Provisioning

Tasks:
- Implement project registration.
- Validate project keys and database names.
- Provision project-specific databases.
- Create owner, migrator, and application roles.
- Verify cross-project access restrictions.

Exit criteria:
- A development database can be provisioned.
- Provisioning failures are recorded.
- Repeated requests do not silently overwrite databases.

## Phase 03 — Migration Management

Tasks:
- Define the migration runner interface.
- Record migration versions and outcomes.
- Prevent concurrent migration execution.
- Add failure reporting and schema verification.

Exit criteria:
- Migrations are versioned, tested, and auditable.
- Production migrations require approval.

## Phase 04 — Backup and Recovery

Tasks:
- Implement logical backups.
- Add checksums and retention.
- Configure protected off-host storage.
- Test restoration into an isolated database.

Exit criteria:
- A project database can be restored and verified.

## Phase 05 — Security and Auditing

Tasks:
- Implement API authentication and authorization.
- Restrict project-level permissions.
- Audit privileged operations.
- Protect credentials and sensitive logs.

Exit criteria:
- Unauthorized cross-project access is denied.
- Administrative actions are traceable.

## Phase 06 — API and Dashboard

Tasks:
- Build project and database endpoints.
- Add health and migration status.
- Display backup history.
- Implement a responsive React dashboard.

Exit criteria:
- Authorized administrators can manage projects through the interface.

## Phase 07 — Production Readiness

Tasks:
- Add automated tests and CI.
- Configure monitoring and alerts.
- Validate restore and incident procedures.
- Document deployment and operational recovery.

Exit criteria:
- Security, recovery, and integration checks pass.
