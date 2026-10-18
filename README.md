# PostgreSQL Project Manager

A centralized PostgreSQL management platform for independent projects, databases, environments, migrations, permissions, backups, and recovery.

## Mission

Build a secure control plane for managing multiple project databases without mixing application data or credentials.

## Architecture

- Admin Web: React and TypeScript.
- Database API: TypeScript.
- Control Registry: PostgreSQL.
- Project Data: separate database per project and environment.
- Migration Runner: version-controlled schema changes.
- Backup Manager: backup, verification, and restoration.
- Access Control: authentication and authorization.
- Audit Logging: administrative operation history.

The control database stores management metadata. Each project database owns its application data.

## Repository Structure

- `apps/admin-web/` — administration interface.
- `services/database-api/` — management API.
- `packages/project-registry/` — project and database metadata.
- `packages/postgres-admin/` — controlled PostgreSQL administration.
- `packages/migration-runner/` — schema migration execution.
- `packages/backup-manager/` — backup and recovery.
- `packages/access-control/` — authorization.
- `packages/audit-logging/` — audit events.
- `database/control-migrations/` — control registry migrations.
- `infrastructure/` — PostgreSQL, backup, and monitoring configuration.
- `docs/` — architecture, security, operations, and recovery.

## Database Naming

| Project | Development | Production |
|---|---|---|
| Ogwusearch Engineering | `ogwusearch_dev` | `ogwusearch_prod` |
| SolarAudit | `solar_audit_dev` | `solar_audit_prod` |
| Resort Platform | `resort_platform_dev` | `resort_platform_prod` |

Control database: `platform_control_db`.

## Development Roadmap

### Phase 01 — Foundation
- [ ] Verify PostgreSQL connectivity.
- [ ] Configure secrets and environment variables.
- [ ] Create the control database.
- [ ] Apply and verify registry migrations.

### Phase 02 — Provisioning
- [ ] Register projects and environments.
- [ ] Create project databases and restricted roles.
- [ ] Verify cross-project isolation.

### Phase 03 — Migrations
- [ ] Implement version tracking and execution.
- [ ] Add concurrency controls and failure handling.

### Phase 04 — Backups
- [ ] Implement backups, checksums, and retention.
- [ ] Store protected off-host copies.
- [ ] Test restoration.

### Phase 05 — Security
- [ ] Implement authentication and authorization.
- [ ] Audit privileged operations.
- [ ] Test access boundaries.

### Phase 06 — API and Dashboard
- [ ] Implement management endpoints.
- [ ] Display databases, health, migrations, and backups.
- [ ] Build the responsive admin interface.

### Phase 07 — Production Readiness
- [ ] Complete integration and security tests.
- [ ] Configure monitoring and alerting.
- [ ] Validate disaster recovery.

## Security Rules

- Use least-privilege roles.
- Keep administrative credentials out of the web interface.
- Never commit production secrets.
- Restrict PostgreSQL network access.
- Validate all administrative operations.
- Never expose arbitrary SQL execution to untrusted clients.
- Require explicit approval for destructive operations.

## Initial Milestone

1. Connect to PostgreSQL.
2. Create `platform_control_db` if absent.
3. Apply the initial registry migration.
4. Register a development project.
5. Provision its database and roles.
6. Run and verify a project migration.
7. Back up and restore the database.
8. Record operation outcomes.

## Definition of Done

Every feature must be documented, tested, authorized, observable, and consistent with the architecture.

## Current Focus

**Phase 01 — Foundation:** establish PostgreSQL connectivity, apply the control registry migration safely, and verify the schema before implementing provisioning.
