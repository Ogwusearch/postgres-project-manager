import { createHash } from "node:crypto";
import {
  type FileHandle,
  chmod,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SecretStoreErrorCode =
  | "INVALID_REFERENCE"
  | "SECRET_ALREADY_EXISTS"
  | "SECRET_NOT_FOUND"
  | "SECRET_STORE_UNAVAILABLE";

export class SecretStoreError extends Error {
  constructor(public readonly code: SecretStoreErrorCode) {
    const messages: Record<SecretStoreErrorCode, string> = {
      INVALID_REFERENCE: "The secret reference is invalid.",
      SECRET_ALREADY_EXISTS: "A secret already exists for this reference.",
      SECRET_NOT_FOUND: "The requested secret was not found.",
      SECRET_STORE_UNAVAILABLE: "The secret store is unavailable.",
    };

    super(messages[code]);
    this.name = "SecretStoreError";
  }
}

type SecretWriter = (
  handle: FileHandle,
  value: string,
) => Promise<void>;

async function writeSecretAndSync(
  handle: FileHandle,
  value: string,
): Promise<void> {
  await handle.writeFile(value, { encoding: "utf8" });
  await handle.sync();
}

export interface SecretStore {
  storeSecret(reference: string, value: string): Promise<void>;
  readSecret(reference: string): Promise<string>;
}

function validateReference(reference: string): void {
  if (
    typeof reference !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(reference) ||
    reference.includes("..")
  ) {
    throw new SecretStoreError("INVALID_REFERENCE");
  }
}

function validateSecret(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export class LocalFileSecretStore implements SecretStore {
  constructor(
    private readonly directory = join(
      homedir(),
      ".config",
      "postgres-project-manager",
      "secrets",
    ),
    private readonly writeSecret: SecretWriter = writeSecretAndSync,
  ) {}

  private filePath(reference: string): string {
    const digest = createHash("sha256")
      .update(reference, "utf8")
      .digest("hex");

    return join(this.directory, `${digest}.secret`);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, {
      recursive: true,
      mode: 0o700,
    });

    const info = await lstat(this.directory);

    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
    }

    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
    }

    await chmod(this.directory, 0o700);

    const secured = await lstat(this.directory);

    if (
      !secured.isDirectory() ||
      secured.isSymbolicLink() ||
      (secured.mode & 0o077) !== 0
    ) {
      throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
    }
  }

  async storeSecret(reference: string, value: string): Promise<void> {
    validateReference(reference);
    validateSecret(value);

    let createdPath: string | undefined;

    try {
      await this.ensureDirectory();

      const path = this.filePath(reference);
      const noFollow = constants.O_NOFOLLOW ?? 0;
      const handle = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          noFollow,
        0o600,
      );
      createdPath = path;

      try {
        await this.writeSecret(handle, value);

        const info = await handle.stat();

        if (
          !info.isFile() ||
          (info.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" &&
            info.uid !== process.getuid())
        ) {
          throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (createdPath !== undefined) {
        try {
          await unlink(createdPath);
        } catch {
          // Preserve the original failure; do not expose filesystem details.
        }
      }

      if (error instanceof SecretStoreError) {
        throw error;
      }

      if (isErrorCode(error, "EEXIST")) {
        throw new SecretStoreError("SECRET_ALREADY_EXISTS");
      }

      throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
    }
  }

  async readSecret(reference: string): Promise<string> {
    validateReference(reference);

    try {
      await this.ensureDirectory();

      const path = this.filePath(reference);
      const noFollow = constants.O_NOFOLLOW ?? 0;
      const handle = await open(path, constants.O_RDONLY | noFollow);

      try {
        const info = await handle.stat();

        if (
          !info.isFile() ||
          (info.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" &&
            info.uid !== process.getuid())
        ) {
          throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
        }

        const value = await handle.readFile({ encoding: "utf8" });

        if (value.length === 0 || value.includes("\0")) {
          throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
        }

        return value;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof SecretStoreError) {
        throw error;
      }

      if (isErrorCode(error, "ENOENT")) {
        throw new SecretStoreError("SECRET_NOT_FOUND");
      }

      throw new SecretStoreError("SECRET_STORE_UNAVAILABLE");
    }
  }
}
