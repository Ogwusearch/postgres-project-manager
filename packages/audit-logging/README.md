# @postgres-project-manager/audit-logging

A database-independent audit-event contract for Postgres Project Manager.

## Responsibilities

- Define the common shape of audit events.
- Validate untrusted event values at runtime.
- Define a transaction-aware `AuditLogger` interface.
- Provide a typed validation error.

## Transaction and atomicity

When a domain mutation and its audit record must be atomic, the application
must write both using the same database transaction. The logger adapter must
use the transaction supplied to `AuditLogger.write`; it must not open a
separate connection for the audit insert.

If the audit insert fails, the failure must propagate so the caller can roll
back the encompassing transaction. Do not silently discard audit failures.

## Persistence adapter

This package intentionally does not yet include a PostgreSQL adapter. Before
adding one, inspect the actual `audit_events` table, existing lifecycle SQL,
and repository transaction interfaces. Map the event contract to those
established columns rather than assuming a schema.

## Security

Build actor and tenant identifiers from trusted server-side context.
Do not accept authorization identity directly from an untrusted request body.
Never put passwords, connection strings, access tokens, or other secrets in
event metadata.

## Development

From the repository root:

    pnpm --filter @postgres-project-manager/audit-logging test
    pnpm --filter @postgres-project-manager/audit-logging typecheck
    pnpm --filter @postgres-project-manager/audit-logging build
