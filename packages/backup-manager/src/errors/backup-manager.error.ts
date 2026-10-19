export class BackupManagerError extends Error {
  readonly code = "BACKUP_INPUT_INVALID";

  constructor(
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = "BackupManagerError";
  }
}
