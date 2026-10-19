export const BACKUP_FORMATS = [
  "custom",
  "plain",
  "directory",
  "tar"
] as const;

export type BackupFormat = (typeof BACKUP_FORMATS)[number];

export interface BackupRequest {
  /** Identifier of the database instance in the platform registry. */
  readonly instanceId: string;

  /** Database name resolved by trusted server-side code. */
  readonly databaseName: string;

  /** Authenticated actor identifier, or null for an approved system task. */
  readonly requestedBy: string | null;

  readonly format: BackupFormat;

  /** Optional, non-secret explanation for creating the backup. */
  readonly reason?: string;
}

export interface BackupChecksum {
  readonly algorithm: "sha256";
  readonly digest: string;
}

/**
 * Internal backup metadata.
 *
 * storageRef is an opaque reference for trusted server-side storage code.
 * It must not be exposed directly in user-facing API responses.
 */
export interface BackupArtifact {
  readonly id: string;
  readonly instanceId: string;
  readonly databaseName: string;
  readonly format: BackupFormat;
  readonly storageRef: string;
  readonly checksum: BackupChecksum;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

export interface BackupVerificationResult {
  readonly artifactId: string;
  readonly verified: boolean;
  readonly checksumValid: boolean;
  readonly readable: boolean;
  readonly checkedAt: Date;
  /** A safe machine-readable failure code; never include credentials. */
  readonly failureCode?: string;
}
