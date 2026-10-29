# PPM Implementation: Database Verification Recovery and Database Discovery

## Project

Repository: `/home/ogwu/workspace/postgres-project-manager`

Architecture: TypeScript, Fastify, PostgreSQL, React, Vite, pnpm workspaces.

## Objective

Complete the existing database-verification lifecycle recovery, then implement a tenant-authorized, read-only Database Discovery API and admin dashboard interface.

The first target is the existing registered Minecore database instance:

- Project key: `minecore`
- Database name: `minecore`
- Instance ID: `ac7b6029-b601-4d55-82d6-86509b9f8d49`
- Trusted server key: `local-postgres`
- Current recorded status: `failed`

Do not create another instance.

## Mandatory safeguards

1. Inspect the current repository and working tree before editing.
2. Preserve all uncommitted changes, backup files, authentication work, and migration safeguards.
3. Never reset, recreate, or migrate `platform_control_db` as part of this task.
4. Never modify Minecore's source tables or records during discovery.
5. Never expose passwords, session tokens, connection strings, or database secrets in API responses or logs.
6. Use the existing trusted-server configuration. Do not accept arbitrary database hosts, users, passwords, or SQL from API clients.
7. Respect tenant ownership, existing authorization policies, CSRF requirements, and audit-event behavior.
8. Do not implement data import in this phase.

## Phase 1 — Finish verification recovery

Inspect `src/app.ts`, `tests/app.test.ts`, and both verification integration tests.

Confirm that successful verification can transition an instance from `failed` to `ready`, while failed verification, concurrent requests, tenant isolation, and atomic auditing retain their existing safeguards.

Add a regression test that starts with an instance in `failed` state and verifies that successful verification produces:

- HTTP 200 and `ok: true`
- `lifecycleStatus: "ready"`
- Persisted instance status `ready`
- An audit event with `status_before: "failed"` and `status_after: "ready"`

Ensure the test executor and PostgreSQL integration tests model the same lifecycle behavior as the production implementation.

Do not claim Minecore is ready until the real API has successfully verified it and the persisted status has been checked.

## Phase 2 — Implement a database discovery service

Create a dedicated service, for example `src/services/database-discovery.ts`.

Use PostgreSQL's `pg` client and the existing `TrustedDatabaseServer` configuration from `src/config/database-servers.ts`.

The service must:

- Connect only to the trusted server and registered database supplied by the application.
- Execute metadata queries inside a read-only transaction.
- Discover schemas, tables, views, and column metadata.
- Return schema names, table names, table types, column names, ordinal positions, PostgreSQL data types, and nullability.
- Exclude PostgreSQL system schemas from ordinary application discovery.
- Never retrieve application row contents or execute user-supplied SQL.
- Avoid expensive table-wide row counts in this initial implementation.
- Apply connection timeouts and reliably close the database connection.
- Return safe, typed errors without exposing driver details or credentials.

Write unit tests using an injectable client factory, covering successful discovery, empty schemas, query failures, cleanup, and read-only behavior.

## Phase 3 — Add the protected discovery API

Inspect how `src/app.ts` authenticates requests and performs tenant-scoped instance authorization.

Add an endpoint following the existing API conventions, such as:

`GET /api/database-instances/:id/discovery`

Requirements:

- Require an authenticated session.
- Enforce tenant ownership and the appropriate database-instance read permission.
- Validate the instance UUID.
- Resolve the trusted server using the existing registered `server_key`.
- Use the registered `database_name`; never accept a replacement database name from the client.
- Require a successfully verified, ready instance before discovery.
- Return a typed response containing database metadata only.
- Fail safely when the target connection or metadata query fails.
- Preserve existing API response conventions and avoid leaking internal errors.

Add API tests for success, invalid IDs, missing instances, cross-tenant access, insufficient permissions, unready instances, target connection failures, and safe error responses.

## Phase 4 — Implement the Database Explorer UI

Inspect `apps/admin-web/src/App.tsx`, its existing CSS, session logic, tenant selector, workspace data loader, and `apps/admin-web/src/STRUCTURE.md` before editing.

Integrate a Database Explorer into the current application structure rather than replacing the dashboard.

Implement:

- A discovery action for eligible, ready database instances.
- Loading, empty, success, and failure states.
- Schema and table navigation.
- A table detail view showing column metadata.
- Clear database and schema context.
- Accessible controls and responsive styling consistent with the existing dashboard.
- Authenticated requests using the existing cookie and tenant-header conventions.
- Proper handling of expired sessions, authorization errors, and stale tenant selections.

Do not show fabricated table data. Do not display an import button that is not implemented.

## Phase 5 — Validate and document

Run:

- `pnpm typecheck`
- `pnpm build`
- Existing API and authentication tests
- New database-discovery unit and API tests
- Targeted PostgreSQL integration tests against an explicitly selected disposable test database

Do not run the complete destructive integration suite against `platform_control_db`.

Run `git diff --check`, review every changed file, and report exactly which tests passed or failed.

Update the relevant project documentation with the endpoint contract, permissions, response types, and verification/discovery workflow.

## Completion criteria

The task is complete only when:

1. The failed-to-ready regression test passes.
2. The real Minecore instance has been verified and its persisted lifecycle status is `ready`.
3. Unauthorized and cross-tenant discovery requests are rejected.
4. The Database Explorer displays real Minecore schema and table metadata.
5. Source application data remains unchanged.
6. Existing authentication, migrations, and unrelated functionality continue to pass their regression checks.

Stop after Database Discovery. Import, migration management, and data synchronization are separate future phases.
## Discovery API contract

`GET /api/database-instances/:id/discovery` requires an authenticated session and a
valid `X-Tenant-Id`. The requester must have `database-instance:read` for the
registered instance's project. The registry record must have lifecycle status
`ready`. The server resolves its trusted connection using the stored `server_key`
and `database_name`; client-supplied connection settings are ignored.

Success returns `{ data: { ok: true, databaseName, discoveredAt, schemas, tables } }`.
Each table contains `schemaName`, `tableName`, `tableType`, and ordered `columns`;
columns contain `columnName`, `ordinalPosition`, `dataType`, `udtName`, and `nullable`.
Connection failures return a generic 502 response; discovery/configuration failures
return safe generic errors. Discovery attempts are recorded as `database.schema.discover`
audit events with success/failure outcome and metadata counts only.

Discovery queries `information_schema` in a read-only transaction with connection and
statement/query timeouts. PostgreSQL system schemas are excluded. It does not read
application table rows, compute table-wide row counts, or modify the target database.
