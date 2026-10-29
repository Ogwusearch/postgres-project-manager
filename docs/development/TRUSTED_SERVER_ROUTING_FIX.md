# Trusted PostgreSQL Server Routing

## Why this exists

A `server_key` must identify one PostgreSQL endpoint. Verification/discovery
and provisioning must not resolve the same key to different hosts or ports.
Connection credentials may differ by operation, but the endpoint must not.

## Trusted keys

- `minecore-postgres`: read-only verification/discovery endpoint. Configure
  `MINECORE_PGHOST`, `MINECORE_PGPORT` (default `5433`), `MINECORE_PGUSER`,
  `MINECORE_PGPASSWORD`, `MINECORE_PGSSL`, and optionally
  `MINECORE_PG_CONNECT_TIMEOUT_MS`.
- `local-postgres`: development provisioning endpoint. Both verification and
  provisioning use `PROVISION_PGHOST` and `PROVISION_PGPORT` (default `55434`)
  for the endpoint. Verification requires separate credentials in
  `LOCAL_POSTGRES_VERIFY_PGUSER` and `LOCAL_POSTGRES_VERIFY_PGPASSWORD`;
  provisioning continues to use `PROVISION_PGUSER` and
  `PROVISION_PGPASSWORD`.

Do not use the provisioning administrator as the verifier account. Create and
provision a dedicated least-privilege verifier role on the development server
before setting these credentials. Missing verifier credentials intentionally
fail closed.

## Existing instance bindings

The registry row for Minecore must use `server_key = 'minecore-postgres'`.
Instances on the development provisioning server continue to use
`server_key = 'local-postgres'`. Do not bulk-update rows by database name alone.
Before changing the protected control database, create and verify a fresh
private backup, confirm the exact instance ID and its current key, update only
that row, and write an audit event in the same transaction.

No database is created or adopted by this routing change. In particular, if
`bankingdb` does not exist on its intended server, it remains unavailable until
an explicitly authorized provisioning workflow creates it.
