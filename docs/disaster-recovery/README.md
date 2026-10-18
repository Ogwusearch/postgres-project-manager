# Disaster Recovery

## 1. Purpose

Define how to recover PostgreSQL databases after data loss, database corruption,
server failure, accidental deletion, or infrastructure failure.

The recovery process must protect the integrity and availability of every
managed project database.

## 2. Recovery Objectives

Each project must define its own recovery objectives.

- Recovery Point Objective (RPO): maximum acceptable data loss.
- Recovery Time Objective (RTO): maximum acceptable recovery duration.

Initial planning targets:

| Environment | Suggested RPO | Suggested RTO |
|---|---|---|
| Development | 24 hours | 8 hours |
| Staging | 24 hours | 8 hours |
| Production | 1 hour | 4 hours |

These are planning targets, not guarantees. Meeting them requires suitable
backup frequency, WAL archiving where needed, sufficient infrastructure,
and tested restoration procedures.

## 3. Failure Scenarios

The recovery plan must address:

- Accidental deletion of records or tables.
- Failed or incompatible database migrations.
- Database corruption.
- PostgreSQL server or host failure.
- Storage failure.
- Lost credentials or compromised database roles.
- Backup corruption or missing backup files.
- Loss of the primary server or backup location.
- Incorrect administrative operations affecting multiple projects.

## 4. Backup Requirements

- Back up every production database independently.
- Capture required PostgreSQL global objects and role definitions securely.
- Store backups outside the primary PostgreSQL host.
- Encrypt backups in transit and at rest.
- Record backup status, timestamps, checksums, and storage references.
- Apply documented retention policies.
- Monitor backup failures and missing scheduled backups.
- Restrict backup access to authorized operators.
- Never store database passwords in source control.

Logical backups support individual database recovery. Physical backups and
Write-Ahead Log (WAL) archiving support cluster recovery and point-in-time
recovery when configured correctly.

A checksum verifies file integrity against the recorded checksum. It does not,
by itself, prove that a backup can be restored.

## 5. Recovery Priorities

Restore services in the following order:

1. Recover the PostgreSQL server or provision a replacement.
2. Restore required cluster configuration and global objects.
3. Restore the project database selected for recovery.
4. Apply WAL recovery when point-in-time recovery is required.
5. Verify database integrity, ownership, and permissions.
6. Validate schema and migration versions.
7. Run application smoke tests.
8. Restore application connectivity.
9. Record the recovery result in the platform audit log.

Restore a single project database whenever possible rather than unnecessarily
restoring every project.

## 6. Logical Database Restore

Before restoration:

- Identify the correct project and environment.
- Confirm the backup timestamp and checksum.
- Determine the intended recovery point.
- Confirm that the destination is correct.
- Obtain authorization for destructive operations.
- Preserve the existing database when feasible.

Example restore into a separate recovery database:

    createdb solar_audit_recovery

    pg_restore \
      --dbname=solar_audit_recovery \
      --exit-on-error \
      /secure-backups/solar_audit_prod.dump

The example assumes the required database privileges, compatible PostgreSQL
versions, and a valid custom-format pg_dump archive.

Review ownership and role requirements before restoring. Do not restore over
the production database until the recovery procedure has been tested and
approved.

## 7. Point-in-Time Recovery

For databases that require point-in-time recovery:

- Configure regular base backups using PostgreSQL-compatible tooling.
- Archive WAL files continuously and reliably.
- Store WAL archives separately from the primary server.
- Document the PostgreSQL version and recovery configuration.
- Record the intended recovery timestamp and time zone.
- Test recovery to a specified point in time.

A logical pg_dump file alone does not provide point-in-time recovery.

## 8. Recovery Verification

Every recovery exercise must verify:

- PostgreSQL is accepting connections.
- The intended database exists.
- Required tables, indexes, constraints, and sequences are present.
- Database owners and grants are correct.
- Migration versions are consistent with the restored schema.
- Critical application queries succeed.
- Project data is consistent with the selected recovery point.
- Applications can reconnect using their restricted service roles.
- No unrelated project database was modified.

Record the start time, completion time, recovery point, errors, and verification
results.

## 9. Recovery Testing Schedule

Recommended initial schedule:

- Monthly: restore a selected database into an isolated test environment.
- Quarterly: conduct a broader recovery exercise.
- After major PostgreSQL upgrades: repeat restore compatibility tests.
- After backup or infrastructure changes: validate the complete backup workflow.
- After a real incident: review the recovery process and update this document.

Production systems with stricter RPO or RTO requirements may require more
frequent testing.

## 10. Incident Procedure

When a recovery incident occurs:

1. Declare and record the incident.
2. Identify affected projects and environments.
3. Stop unsafe automated jobs and prevent further damage.
4. Preserve logs, available backups, and relevant evidence.
5. Select an appropriate recovery point.
6. Obtain required authorization.
7. Restore into an isolated environment when practical.
8. Verify integrity and application behavior.
9. Approve and perform the production cutover.
10. Monitor service health and reconcile missing transactions if necessary.
11. Document the root cause and corrective actions.

Never assume a restore succeeded merely because the command exited successfully.

## 11. Security and Access

- Limit restoration privileges to authorized operators.
- Protect encryption keys separately from backup storage.
- Audit backup downloads, restores, and destructive operations.
- Rotate credentials after suspected compromise.
- Restrict network access to database administration services.
- Verify access controls after restoring global objects or database grants.

## 12. Recovery Records

For each exercise or incident, record:

- Incident or exercise identifier.
- Project and environment.
- Source server and destination server.
- Backup identifier and recovery point.
- Operator and approval reference.
- Start and completion timestamps.
- RPO and RTO achieved.
- Integrity and application test results.
- Outstanding issues and corrective actions.

## 13. Completion Criteria

Recovery is complete only when:

- The intended database is restored.
- Data integrity checks pass.
- Required permissions are verified.
- The application passes its agreed smoke tests.
- Service health is monitored after cutover.
- Recovery records and audit events are saved.
- Follow-up actions have assigned owners.

## 14. Maintenance

Review this document after recovery incidents, significant architecture changes,
database upgrades, or changes to backup infrastructure.
