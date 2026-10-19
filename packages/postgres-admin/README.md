# PostgreSQL Admin

Foundational administrative utilities for PostgreSQL Project Manager.

## Current scope

- `quoteIdentifier(identifier)` safely quotes PostgreSQL identifiers by doubling embedded double quotes.
- `SqlExecutor` defines a driver-independent contract for parameterized SQL.
- `SqlQueryResult` defines the query-result shape used by administrative services.

## Usage

Import `quoteIdentifier` from `@postgres-project-manager/postgres-admin` to quote SQL identifiers.

Use `quoteIdentifier` for identifiers only. Use parameterized queries for SQL data values.

## Development

Run these commands from the workspace root:

```bash
pnpm --filter @postgres-project-manager/postgres-admin test
pnpm --filter @postgres-project-manager/postgres-admin typecheck
pnpm --filter @postgres-project-manager/postgres-admin build
```

## Boundaries

This package does not currently open database connections, create or drop databases, modify roles or privileges, or execute migrations.
