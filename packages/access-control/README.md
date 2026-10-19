# Access Control

Reusable authorization library for PostgreSQL Project Manager.

## Responsibilities

- Define supported project and database-instance permissions.
- Represent trusted subjects and protected resources.
- Apply project and database-instance authorization policies.
- Return explicit allow or deny decisions.
- Provide a typed error for application layers that need exceptions.
- Deny requests when permissions or required scopes are missing.

## Security boundary

The API or another trusted server-side component must authenticate the caller
and construct `AccessSubject` using trusted identity, tenant-membership,
project-assignment, and permission data.

Construct resources from trusted server-side records. Never trust
client-supplied tenant IDs, project assignments, or permissions.

The authorization library does not authenticate users, load records, assign
roles, or connect to PostgreSQL. An allowed decision does not replace
database constraints, tenant isolation, or authorization checks at the data
access boundary.

## Initial permission model

Actions include project creation, reading, updating, and deletion, along with
database-instance creation, reading, updating, and deletion.

Project creation is evaluated against a tenant resource. Other project
operations require a project resource. Database-instance creation is
evaluated against the parent project; other instance operations require an
instance resource.

Subjects must belong to the target tenant. Project-scoped actions also
require the relevant project to be within the subject's authorized scope.

Role-to-permission mapping is intentionally deferred until the application's
identity, membership, and role contracts are established.

## Development

From the monorepo root:

```bash
pnpm --filter @postgres-project-manager/access-control test
pnpm --filter @postgres-project-manager/access-control typecheck
pnpm --filter @postgres-project-manager/access-control build
```
