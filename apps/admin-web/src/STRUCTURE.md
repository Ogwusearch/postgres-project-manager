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
