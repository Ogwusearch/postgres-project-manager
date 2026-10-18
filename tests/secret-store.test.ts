import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  LocalFileSecretStore,
  SecretStoreError,
} from "../src/services/secret-store.js";

async function withStore(
  run: (directory: string, store: LocalFileSecretStore) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "ppm-secret-store-"));

  try {
    await run(directory, new LocalFileSecretStore(join(directory, "secrets")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("stores and reads a secret without exposing it in the reference", async () => {
  await withStore(async (directory, store) => {
    const reference = "projects/example/development/app-password";
    const secret = "test-only-secret-value";

    await store.storeSecret(reference, secret);

    assert.equal(await store.readSecret(reference), secret);

    const directoryInfo = await stat(join(directory, "secrets"));
    assert.equal(directoryInfo.mode & 0o777, 0o700);

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(directory, "secrets"));

    assert.equal(files.length, 1);
    assert.notEqual(files[0], reference);
    assert.match(files[0]!, /^[a-f0-9]{64}\.secret$/);

    const fileInfo = await stat(join(directory, "secrets", files[0]!));
    assert.equal(fileInfo.mode & 0o777, 0o600);
  });
});

test("does not overwrite an existing secret", async () => {
  await withStore(async (_directory, store) => {
    await store.storeSecret("project/test/app", "original");

    await assert.rejects(
      store.storeSecret("project/test/app", "replacement"),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_ALREADY_EXISTS",
    );

    assert.equal(await store.readSecret("project/test/app"), "original");
  });
});

test("rejects invalid and traversal-like references", async () => {
  await withStore(async (_directory, store) => {
    for (const reference of [
      "",
      "../outside",
      "project/../../outside",
      "has whitespace",
      "/absolute/reference",
    ]) {
      await assert.rejects(
        store.storeSecret(reference, "value"),
        (error: unknown) =>
          error instanceof SecretStoreError &&
          error.code === "INVALID_REFERENCE",
      );
    }
  });
});

test("reports missing secrets with a safe error", async () => {
  await withStore(async (_directory, store) => {
    await assert.rejects(
      store.readSecret("project/missing/app"),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_NOT_FOUND" &&
        !error.message.includes("project/missing/app"),
    );
  });
});

test("rejects empty secret values", async () => {
  await withStore(async (_directory, store) => {
    await assert.rejects(
      store.storeSecret("project/test/app", ""),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_STORE_UNAVAILABLE",
    );
  });
});


test("rejects a symlink in place of a secret file", async () => {
  await withStore(async (directory, store) => {
    const reference = "project/symlink/app";
    const secretsDirectory = join(directory, "secrets");
    await mkdir(secretsDirectory, { mode: 0o700 });

    const digest = createHash("sha256")
      .update(reference, "utf8")
      .digest("hex");

    const secretPath = join(secretsDirectory, `${digest}.secret`);
    const externalPath = join(directory, "external-secret");

    await writeFile(externalPath, "outside-value", { mode: 0o600 });
    await symlink(externalPath, secretPath);

    await assert.rejects(
      store.readSecret(reference),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_STORE_UNAVAILABLE",
    );
  });
});

test("rejects a symlink used as the secret directory", async () => {
  await withStore(async (directory) => {
    const actualDirectory = join(directory, "actual");
    const linkedDirectory = join(directory, "linked");

    await mkdir(actualDirectory, { mode: 0o700 });
    await symlink(actualDirectory, linkedDirectory);

    const store = new LocalFileSecretStore(linkedDirectory);

    await assert.rejects(
      store.storeSecret("project/test/app", "test-only-value"),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_STORE_UNAVAILABLE",
    );
  });
});

test("restricts an existing secret directory to owner-only permissions", async () => {
  await withStore(async (directory, store) => {
    const secretsDirectory = join(directory, "secrets");

    await mkdir(secretsDirectory, { mode: 0o755 });
    await chmod(secretsDirectory, 0o755);

    await store.storeSecret("project/permissions/app", "test-only-value");

    const directoryInfo = await stat(secretsDirectory);
    assert.equal(directoryInfo.mode & 0o777, 0o700);
  });
});


test("removes a partially written secret when writing fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ppm-secret-store-failure-"));
  const secretsDirectory = join(directory, "secrets");

  try {
    const store = new LocalFileSecretStore(
      secretsDirectory,
      async (handle) => {
        await handle.writeFile("partial-test-value", { encoding: "utf8" });
        throw new Error("simulated test write failure");
      },
    );

    await assert.rejects(
      store.storeSecret("project/failure/app", "complete-test-value"),
      (error: unknown) =>
        error instanceof SecretStoreError &&
        error.code === "SECRET_STORE_UNAVAILABLE",
    );

    assert.deepEqual(await readdir(secretsDirectory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
