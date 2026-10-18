# PostgreSQL Security

## 1. Purpose

Define the security controls for the PostgreSQL Project Manager.

The platform manages independent project databases on a shared PostgreSQL server. Security controls must prevent unauthorized access, reduce administrative risk, protect credentials, and preserve data integrity.

## 2. Security Objectives

- Isolate project database access.
- Enforce least-privilege permissions.
- Protect administrative credentials.
- Secure network connections.
- Control schema migrations and destructive operations.
- Encrypt and protect database backups.
- Record privileged actions.
- Support incident response and recovery.

## 3. Security Architecture

The security boundary consists of:

1. Management API authentication and authorization.
2. PostgreSQL server authentication.
3. Project-specific database roles.
4. Database and schema permissions.
5. Secure secret management.
6. Network restrictions and TLS.
7. Audit logging and monitoring.
8. Backup and recovery controls.

The web interface must never connect directly to PostgreSQL using an administrative credential.

The management API must expose approved operations instead of accepting arbitrary SQL from clients.

## 4. Authentication

- Use strong, unique credentials for every service and role.
- Prefer SCRAM-SHA-256 for PostgreSQL password authentication where applicable.
- Use TLS for connections crossing untrusted networks.
- Restrict administrative access to trusted hosts or networks.
- Rotate credentials when compromised or when required by policy.
- Disable or revoke credentials when access is no longer needed.
- Never store plaintext production passwords in source control.

Where supported, use managed secrets rather than distributing credentials through configuration files.

## 5. Authorization and Role Design

Maintain separate roles for:

- Platform administration.
- Database ownership.
- Schema migrations.
- Application runtime.
- Read-only reporting.
- Backup and monitoring.

Use non-login owner roles where practical. Grant login roles only the permissions required for their tasks.

Application roles must not have:

- SUPERUSER privileges.
- CREATEROLE or CREATEDB privileges.
- Unnecessary schema creation or alteration privileges.
- Access to unrelated project databases.
- Permission to administer other projects' roles.

Review database, schema, table, sequence, and function privileges. Configure default privileges for objects created by the intended owner or migration role.

Do not assume that revoking CONNECT alone is a complete isolation mechanism. Review PUBLIC privileges, role memberships, inherited permissions, schema access, and privileged administrative paths.

## 6. Project Isolation

Each project and environment must use its own database and application credentials.

Example:

- solar_audit_dev
- solar_audit_prod
- resort_platform_dev
- resort_platform_prod

Credentials for SolarAudit must not provide administrative access to the Resort Platform database.

A shared PostgreSQL server still shares resources and server-level failure risk. Use separate PostgreSQL instances when stronger operational or security isolation is required.

## 7. Network Security

- Do not expose PostgreSQL directly to the public internet by default.
- Restrict inbound traffic through host and network firewalls.
- Bind PostgreSQL to appropriate network interfaces.
- Configure pg_hba.conf with narrow host, database, and role rules.
- Require TLS for remote connections.
- Keep administrative access on trusted networks or through secure tunnels.
- Review network rules when services are added or removed.

## 8. Secret Management

- Keep .env files containing secrets out of Git.
- Commit only sanitized configuration templates.
- Use unique credentials for each project and environment.
- Avoid passwords in shell history, command-line arguments, and logs.
- Restrict secret-file permissions.
- Rotate credentials after suspected exposure.
- Maintain a documented revocation and recovery procedure.

The project registry must store secret references or metadata, not plaintext database passwords.

## 9. Migration Security

- Store migrations in version control.
- Review migration changes before execution.
- Test migrations in development.
- Require explicit approval for sensitive production changes.
- Run migrations using a dedicated role.
- Prevent runtime application credentials from altering schemas.
- Record migration identity, version, target database, result, and timestamps.
- Define recovery or forward-fix procedures for risky migrations.

Never allow an unauthenticated user or ordinary dashboard user to submit arbitrary production SQL.

## 10. Administrative API Security

The management API must:

- Authenticate every privileged request.
- Authorize each operation against the actor's permissions.
- Validate project identifiers and environment names.
- Use an allowlist of supported administrative operations.
- Prevent command injection and SQL injection.
- Apply rate limits where appropriate.
- Log success and failure outcomes.
- Require additional confirmation for destructive operations.
- Avoid returning credentials or sensitive connection details to the browser.

Do not build shell commands by concatenating untrusted user input.

## 11. Backup Security

- Encrypt backups at rest and during transfer.
- Restrict access to backup storage.
- Store backup copies outside the database host.
- Separate backup administration from ordinary application access.
- Protect encryption keys separately from backup files.
- Verify backup checksums and archive integrity.
- Test restoration in an isolated environment.
- Record backup and restore operations.
- Apply documented retention and deletion policies.

A backup is not considered reliable until restoration has been tested.

## 12. Audit Logging and Monitoring

Record security-relevant events such as:

- Authentication failures.
- Role and privilege changes.
- Database creation and retirement.
- Production migrations.
- Backup and restoration operations.
- Credential rotation.
- Changes to network or access configuration.
- Failed or denied administrative requests.

Each event should include an actor, action, target, outcome, timestamp, and relevant non-secret context.

Do not log passwords, access tokens, private keys, or complete sensitive connection strings.

Protect audit records against unauthorized modification and deletion.

## 13. Incident Response

When a security incident is suspected:

1. Identify the affected project, database, and credentials.
2. Restrict compromised access.
3. Preserve relevant logs and evidence.
4. Rotate or revoke exposed credentials.
5. Assess potential data exposure or modification.
6. Restore service through an approved recovery process.
7. Verify integrity and application behavior.
8. Document the incident and preventive actions.

Follow applicable legal, contractual, and organizational reporting requirements.

## 14. Security Roadmap

### Phase 1 — Foundation

- [ ] Secure administrative access.
- [ ] Configure PostgreSQL authentication.
- [ ] Restrict network access.
- [ ] Protect local configuration and secrets.
- [ ] Define development and production boundaries.

### Phase 2 — Access Control

- [ ] Create project-specific roles.
- [ ] Apply least-privilege grants.
- [ ] Restrict role membership and inheritance.
- [ ] Verify database and schema isolation.
- [ ] Test permissions using real application credentials.

### Phase 3 — API Security

- [ ] Implement authentication and authorization.
- [ ] Validate all administrative inputs.
- [ ] Allowlist supported operations.
- [ ] Protect against SQL and command injection.
- [ ] Require approval for destructive actions.

### Phase 4 — Operational Security

- [ ] Secure migration execution.
- [ ] Enable security-relevant logging.
- [ ] Monitor authentication and privilege changes.
- [ ] Establish credential rotation procedures.
- [ ] Review and test security configuration.

### Phase 5 — Backup and Recovery

- [ ] Encrypt backup storage and transfers.
- [ ] Restrict backup and restore privileges.
- [ ] Store backups off-host.
- [ ] Verify backup integrity.
- [ ] Perform documented restoration tests.

### Phase 6 — Production Readiness

- [ ] Review PostgreSQL role memberships and grants.
- [ ] Test unauthorized cross-project access.
- [ ] Verify TLS and network restrictions.
- [ ] Test incident-response procedures.
- [ ] Confirm monitoring and alerting.
- [ ] Document accepted residual risks.

## 15. Security Acceptance Criteria

The platform is not production-ready until:

- Project credentials cannot access unrelated project data.
- Application roles cannot administer PostgreSQL.
- Administrative endpoints enforce authorization.
- Production migrations are controlled and auditable.
- Secrets are not exposed in source control or logs.
- Backups are protected and successfully restorable.
- Security events are recorded and reviewed.
- Incident-response and recovery procedures have been tested.

## 16. Maintenance

Review this policy whenever the architecture, PostgreSQL version, authentication mechanism, role model, API permissions, or backup infrastructure changes.

Perform periodic access reviews and repeat security acceptance tests before major production releases.
