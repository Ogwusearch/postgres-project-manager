# Admin Web Source Structure

## Application
- app/: application composition and application-level types.
- main.tsx: frontend entry point.

## Features
- features/auth/: login, session restoration, logout and authentication UI.
- features/workspaces/: tenant selection and tenant-scoped data loading.
- features/overview/: dashboard metrics and summary panels.
- features/projects/: project management.
- features/instances/: database instance management.
- features/operations/components/OperationsPage.tsx: tenant-scoped migrations and backup
  history, registry monitoring, audit viewing, workspace membership directory, and
  read-only account/workspace settings.
- features/users/: user administration.
- features/roles/: role assignments.
- features/migrations/: database migration operations.
- features/backups/: backup management.
- features/audit/: audit event viewing.

## Shared
- components/ui/: reusable UI primitives.
- components/layout/: application shell, sidebar and topbar.
- lib/api/: shared API utilities.

## Existing modules
Keep navigation.ts, tenant-visibility.ts, workspace-data-loader.ts,
and existing API services in place until their imports and tests
have been reviewed.

## Refactoring rules
1. Move one feature at a time.
2. Preserve existing API contracts.
3. Preserve tenant isolation and request cancellation.
4. Never weaken server-side authorization.
5. Do not overwrite existing source files during scaffolding.
6. Run typecheck and build after each extraction.

## Database discovery
- features/instances/components/DatabaseExplorer.tsx: registered instance verification,
  read-only schema discovery, schema/table navigation, and column metadata display.
- Discovery requests use the selected tenant header and authenticated session cookies.
  The UI only enables discovery for instances reported as ready; server authorization
  remains authoritative.

## Operations API behavior
- Migrations and Backups are read-only history views in this phase; execution and restore actions are not implemented.
- Monitoring shows control database readiness and registered lifecycle counts, not continuous target database probes.
- Audit history is scoped through accessible project/database targets and requires the separately reviewed operations-read permissions migration.
- Users & access is read-only; invites, role changes, and project assignment edits are not implemented.
- Settings reflects the current session and tenant context only; a persistent editable settings API is not implemented.
