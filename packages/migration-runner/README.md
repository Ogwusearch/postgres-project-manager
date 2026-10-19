# Migration Runner

Reusable migration-management primitives for PostgreSQL Project Manager.

## Responsibilities

- Represent migration files and applied migration history.
- Validate migration filenames, versions, and checksums.
- Validate migration ordering and contiguous version sequences.
- Prepare transaction-wrapped SQL safely.
- Plan pending migrations against verified migration history.
- Provide a testable execution boundary for database adapters.

## Separation of responsibilities

The package must not load application environment files, select a production
database, or silently baseline an existing schema.

Database-specific connection configuration, control-registry schema
verification, protected-database safeguards, advisory locking, and CLI
argument handling remain in the application integration layer.

Migration execution must preserve transaction boundaries and must not record
a migration as applied unless its SQL and history update commit successfully.

## Development

From the monorepo root:

```bash
pnpm --filter @postgres-project-manager/migration-runner test
pnpm --filter @postgres-project-manager/migration-runner typecheck
pnpm --filter @postgres-project-manager/migration-runner build
````
