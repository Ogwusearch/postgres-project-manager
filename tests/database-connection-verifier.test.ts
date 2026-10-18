import test from "node:test";
import assert from "node:assert/strict";
import { verifyDatabaseConnection } from "../src/services/database-connection-verifier.js";

test("verification attempts client cleanup when connection fails", async () => {
  let endCalled = false;

  const server = {
    key: "local-postgres",
    host: "127.0.0.1",
    port: 55432,
    user: "test-user",
    password: "test-password",
    ssl: "disable" as const,
    connectTimeoutMs: 3000,
  };

  const result = await verifyDatabaseConnection(
    server,
    "test_database",
    () => ({
      async connect() {
        throw new Error("Simulated connection failure");
      },
      async query() {
        return { rows: [] };
      },
      async end() {
        endCalled = true;
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "CONNECTION_FAILED");
  assert.equal(endCalled, true);
});
