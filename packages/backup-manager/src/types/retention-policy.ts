/**
 * Retention policy describes what should be retained.
 *
 * It does not implement deletion. A future cleanup service must separately
 * authorize deletion, protect required backups, and audit each operation.
 */
export interface BackupRetentionPolicy {
  readonly enabled: boolean;
  readonly retainLast: number;
  readonly maxAgeDays: number;
  readonly requireVerifiedBackupBeforePrune: boolean;
}
