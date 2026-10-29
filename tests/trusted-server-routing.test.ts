import test from "node:test";
import assert from "node:assert/strict";
import { getTrustedDatabaseServer } from "../src/config/database-servers.js";
import { getTrustedProvisioningServer } from "../src/config/provisioning-server.js";

const envKeys = [
  "MINECORE_PGHOST",
  "MINECORE_PGPORT",
  "MINECORE_PGUSER",
  "MINECORE_PGPASSWORD",
  "MINECORE_PGSSL",
  "MINECORE_PG_CONNECT_TIMEOUT_MS",
  "TARGET_PGHOST",
  "TARGET_PGPORT",
  "TARGET_PGUSER",
  "TARGET_PGPASSWORD",
  "TARGET_PGSSL",
  "TARGET_PG_CONNECT_TIMEOUT_MS",
  "PROVISION_PGHOST",
  "PROVISION_PGPORT",
  "PROVISION_PGUSER",
  "PROVISION_PGPASSWORD",
  "PROVISION_PGSSL",
  "PROVISION_PG_CONNECT_TIMEOUT_MS",
  "LOCAL_POSTGRES_VERIFY_PGUSER",
  "LOCAL_POSTGRES_VERIFY_PGPASSWORD",
  "LOCAL_POSTGRES_VERIFY_CONNECT_TIMEOUT_MS",
] as const;

type EnvKey = (typeof envKeys)[number];

function withEnv(values: Partial<Record<EnvKey, string>>, run: () => void) {
  const previous = new Map<EnvKey, string | undefined>();
  for (const key of envKeys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key as EnvKey] = value;
  }

  try {
    run();
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Minecore key resolves only to its dedicated target configuration", () => {
  withEnv(
    {
      MINECORE_PGHOST: "127.0.0.1",
      MINECORE_PGPORT: "5433",
      MINECORE_PGUSER: "ppm_minecore_reader",
      MINECORE_PGPASSWORD: "test-only-secret",
      MINECORE_PGSSL: "disable",
      MINECORE_PG_CONNECT_TIMEOUT_MS: "5000",
      TARGET_PGHOST: "127.0.0.1",
      TARGET_PGPORT: "55432",
      TARGET_PGUSER: "wrong-legacy-user",
      TARGET_PGPASSWORD: "wrong-legacy-secret",
    },
    () => {
      const server = getTrustedDatabaseServer("minecore-postgres");
      assert.equal(server.key, "minecore-postgres");
      assert.equal(server.port, 5433);
      assert.equal(server.user, "ppm_minecore_reader");
      assert.equal(server.password, "test-only-secret");
    },
  );
});

test("local-postgres verifier shares the provisioning endpoint but not credentials", () => {
  withEnv(
    {
      PROVISION_PGHOST: "127.0.0.1",
      PROVISION_PGPORT: "55434",
      PROVISION_PGUSER: "ppm_dev_admin",
      PROVISION_PGPASSWORD: "admin-test-secret",
      PROVISION_PGSSL: "disable",
      LOCAL_POSTGRES_VERIFY_PGUSER: "ppm_dev_reader",
      LOCAL_POSTGRES_VERIFY_PGPASSWORD: "reader-test-secret",
    },
    () => {
      const verifier = getTrustedDatabaseServer("local-postgres");
      const provisioner = getTrustedProvisioningServer("local-postgres");

      assert.equal(verifier.host, provisioner.host);
      assert.equal(verifier.port, provisioner.port);
      assert.equal(verifier.user, "ppm_dev_reader");
      assert.equal(verifier.password, "reader-test-secret");
      assert.equal(verifier.password === provisioner.password, false);
    },
  );
});

test("local-postgres verification fails closed without its separate read-only credentials", () => {
  withEnv(
    {
      PROVISION_PGHOST: "127.0.0.1",
      PROVISION_PGPORT: "55434",
      PROVISION_PGUSER: "ppm_dev_admin",
      PROVISION_PGPASSWORD: "admin-test-secret",
      PROVISION_PGSSL: "disable",
    },
    () => {
      assert.throws(
        () => getTrustedDatabaseServer("local-postgres"),
        /LOCAL_POSTGRES_VERIFY_PGUSER/,
      );
    },
  );
});

test("unknown server keys are rejected", () => {
  assert.throws(
    () => getTrustedDatabaseServer("untrusted-postgres"),
    /Unknown trusted database server/,
  );
});
