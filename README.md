# PostgreSQL Project Manager

A centralized PostgreSQL management platform for independent projects, databases, environments, migrations, access permissions, backups, and recovery.

## Mission

Build a secure control plane for managing multiple project databases without mixing application data, tenant access, or credentials.

## Architecture

- **Admin Web:** React, TypeScript, and Vite.
- **Management API:** TypeScript and Fastify.
- **Control Registry:** PostgreSQL for projects, database instances, authentication, tenancy, and management metadata.
- **Project Data:** Separate databases for projects and environments.
- **Migration Runner:** Version-controlled database schema changes.
- **Backup Manager:** Backup creation, verification, retention, and restoration.
- **Access Control:** Authentication, tenant isolation, project assignments, and role-based authorization.
- **Audit Logging:** Records administrative operations and their outcomes.
- **Monitoring:** Health checks and operational visibility.

The control database stores management metadata. Each project database owns its application data. Application access must not permit one tenant to access another tenant's projects or databases.

## Repository Structure

```text
postgres-project-manager/
├── apps/
│   └── admin-web/                # React administration interface
├── database/
│   └── control-migrations/       # Control database schema migrations
├── docs/
│   ├── architecture/
│   ├── disaster-recovery/
│   ├── operations/
│   └── security/
├── infrastructure/
│   ├── backups/
│   ├── monitoring/
│   └── postgres/
├── packages/
│   ├── access-control/           # Authorization package
│   ├── audit-logging/            # Audit logging package
│   ├── backup-manager/           # Backup and recovery package
│   ├── migration-runner/         # Schema migration package
│   ├── postgres-admin/           # Controlled PostgreSQL operations
│   └── project-registry/         # Project registry package
├── scripts/                      # Setup, migration, bootstrap, and test scripts
├── src/
│   ├── repositories/             # Database access and persistence
│   ├── services/                 # Authentication and application services
│   ├── app.ts                    # Fastify application and routes
│   └── server.ts                 # Server entry point
├── tests/
│   ├── integration/
│   └── *.test.ts
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

This tree describes the principal directories. Some packages and application areas may still need implementation or integration.

## Database Naming

| Project | Development | Production |
|---|---|---|
| Ogwusearch Engineering | `ogwusearch_dev` | `ogwusearch_prod` |
| SolarAudit | `solar_audit_dev` | `solar_audit_prod` |
| Resort Platform | `resort_platform_dev` | `resort_platform_prod` |

**Control database:** `platform_control_db`

These names are conventions; registering a project in the control registry does not mean its databases have already been provisioned.

## Multi-Tenant User Interface

The platform uses one shared administration interface. The authenticated user's role and permissions determine which projects, data, navigation items, and actions are available.

| Role | Intended responsibilities |
|---|---|
| `super_admin` | Platform administration and authorized tenant management |
| `admin` | Manage projects and database instances within the assigned tenant |
| `database_operator` | Perform permitted database operations on assigned projects |
| `viewer` | Read-only access to authorized project and database information |

### Interface Principles

- Resolve the authenticated user and authorized tenant before loading tenant-specific data.
- Enforce authorization on the API; hiding a button is not an access-control mechanism.
- Display only projects and database instances the user is permitted to access.
- Require explicit confirmation for destructive or difficult-to-reverse operations.
- Never expose PostgreSQL administrative credentials or session secrets in the browser.
- Show meaningful loading, error, access-denied, and empty states.
- Record security-sensitive administrative actions in the audit system.

### Planned Interface Areas

- Dashboard and health status
- Tenant and user administration
- Projects and environments
- Database instances
- Migration status and execution history
- Backup status and restoration workflows
- Audit history
- Access and account settings

These are planned interface capabilities, not a claim that every screen or endpoint is complete.

## Control Database Migrations

Control database migrations are maintained in `database/control-migrations/`.

The migration tooling is designed to provide version tracking, checksums, serialized execution, transactional migration handling, and safe baseline support for an existing schema.

Operational requirements:

- Review migration SQL before execution.
- Use a disposable test database to validate migration behavior.
- Verify migration history and schema state after execution.
- Never assume that a migration has been applied merely because its file exists.
- Do not apply a new authentication or tenancy migration to the main control database until its safety, compatibility, and recovery plan have been verified.
- Keep migration credentials separate from the normal application's database credentials.

## Security Rules

- Enforce least privilege for PostgreSQL roles and application users.
- Authenticate requests before allowing protected API operations.
- Verify tenant membership and project assignments on the server.
- Scope database queries to the authorized tenant and project.
- Protect state-changing requests against cross-site request forgery where cookie authentication is used.
- Keep administrative credentials out of the browser and source control.
- Restrict PostgreSQL network access.
- Never expose arbitrary SQL execution to untrusted clients.
- Validate administrative operations and their inputs.
- Require explicit approval for destructive operations.
- Avoid returning credentials, connection strings, password hashes, or session secrets in API responses or logs.
- Audit privileged operations and retain their outcomes.
- Test tenant isolation and role boundaries, including denied requests.

## Development Roadmap

### Phase 01 — Foundation

- [ ] Verify PostgreSQL connectivity and target database configuration.
- [ ] Validate environment variables and secret handling.
- [ ] Verify the control database and migration history.
- [ ] Apply and verify migrations in a disposable database.
- [ ] Document the safe procedure for initializing an existing control database.

### Phase 02 — Provisioning

- [ ] Register projects and environments through authorized API operations.
- [ ] Provision project databases and restricted database roles.
- [ ] Validate project and tenant ownership constraints.
- [ ] Test cross-project and cross-tenant isolation.

### Phase 03 — Migrations

- [ ] Integrate project schema migrations with the management API.
- [ ] Track migration versions and checksums.
- [ ] Test concurrency, failure handling, and recovery behavior.
- [ ] Prevent unauthorized migration execution.

### Phase 04 — Backups and Recovery

- [ ] Implement controlled backup creation.
- [ ] Add checksum verification and retention policies.
- [ ] Store protected off-host backup copies.
- [ ] Test restoration into an isolated target.
- [ ] Document and rehearse disaster recovery.

### Phase 05 — Authentication and Authorization

- [ ] Complete authentication and session lifecycle handling.
- [ ] Verify tenant membership and project assignments.
- [ ] Enforce role permissions on every protected API operation.
- [ ] Test unauthorized, unauthenticated, and cross-tenant requests.
- [ ] Complete the audit logging and access-review design.

### Phase 06 — API and Administration Interface

- [ ] Complete the management endpoints.
- [ ] Integrate the React administration interface with the API.
- [ ] Implement role-aware navigation and actions.
- [ ] Display database health and operational status.
- [ ] Add migration and backup management workflows.
- [ ] Verify frontend and backend authorization behavior together.

### Phase 07 — Production Readiness

- [ ] Complete automated, integration, and security tests.
- [ ] Configure monitoring and alerting.
- [ ] Verify deployment configuration and secret handling.
- [ ] Validate disaster recovery and restoration procedures.
- [ ] Document operational runbooks and incident response.
- [ ] Complete a security review before production deployment.

## Development Commands

Run commands from the repository root.

```bash
# Install workspace dependencies
pnpm install

# Type-check the project
pnpm typecheck

# Run the unit and application test suite
pnpm test

# Build the application
pnpm build

# Run integration tests only after verifying their database target
pnpm test:integration

# Inspect the control migration runner's supported options
pnpm db:migrate:control --help
```

**Integration-test safety:** Confirm that the configured target is a disposable test database before running integration tests. Never assume an integration test is safe for a shared or production control database.

## Definition of Done

A feature is complete only when it is:

- Implemented and documented.
- Tested at the appropriate level.
- Authorized on the server.
- Scoped correctly to its tenant and project.
- Observable through useful logs, health checks, and operation outcomes.
- Reviewed for credential exposure and failure behavior.
- Consistent with the platform's architecture and recovery requirements.

## Current Focus

**Authentication, tenancy, and control registry safety.**

The immediate priority is to validate the authentication and tenant-isolation implementation, review the new control migration, verify the migration tooling against a disposable PostgreSQL database, and ensure that protected API routes enforce permissions correctly.

The main control database must remain unchanged until the migration and rollout procedure have been reviewed and verified.
