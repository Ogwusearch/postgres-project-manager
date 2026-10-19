import type {
  BackupArtifact,
  BackupRequest,
  BackupVerificationResult
} from "./backup.js";

/**
 * Port implemented by a trusted backup provider.
 *
 * TContext is supplied by the application so that this package does not
 * depend on a particular database driver, storage SDK, or credentials type.
 */
export interface BackupManager<TContext> {
  createBackup(
    request: BackupRequest,
    context: TContext
  ): Promise<BackupArtifact>;

  verifyBackup(
    artifact: BackupArtifact,
    context: TContext
  ): Promise<BackupVerificationResult>;
}
