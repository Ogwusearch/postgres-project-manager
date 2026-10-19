# @postgres-project-manager/project-registry

Domain contracts and runtime validation for registered projects and database instances.

## Responsibilities

- Define project and database-instance domain types.
- Validate creation inputs and persisted records using Zod.
- Provide repository and registry interfaces.
- Prevent clients from setting lifecycle-controlled fields through creation inputs.

## Boundaries

This package does not:

- Open PostgreSQL connections or execute SQL.
- Define or execute database migrations.
- Provision, drop, or modify databases.
- Implement HTTP routes.
- Make authorization decisions.
- Store database credentials or passwords.

## Development

Run the package tests:

```bash
pnpm --filter @postgres-project-manager/project-registry test
```

Run the TypeScript type checker:

```bash
pnpm --filter @postgres-project-manager/project-registry typecheck
```

Build the package:

```bash
pnpm --filter @postgres-project-manager/project-registry build
```

The package uses the workspace's existing Zod, TypeScript, `tsx`, and `@types/node` dependencies.

## Integration Status

This package initially provides domain contracts and validation only. The root application's existing repositories and services remain authoritative until a separate integration change adopts these contracts and verifies compatibility.
