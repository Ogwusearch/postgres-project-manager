import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverDatabaseMetadata,
  type DatabaseDiscoveryClient,
  type DatabaseDiscoveryClientFactory,
} from "../src/services/database-discovery.js";
import type { TrustedDatabaseServer } from "../src/config/database-servers.js";

const trustedServer: TrustedDatabaseServer = {
  key: "local-postgres",
  host: "127.0.0.1",
  port: 5432,
  user: "read_only_user",
  password: "test-secret-not-logged",
  ssl: "disable",
  connectTimeoutMs: 3000,
};

function createClientFactory(options: {
  schemas?: Array<Record<string, unknown>>;
  tables?: Array<Record<string, unknown>>;
  failConnect?: boolean;
  failMetadata?: boolean;
  calls?: string[];
  config?: Record<string, unknown>[];
} = {}): DatabaseDiscoveryClientFactory {
  return (configuration) => {
    options.config?.push(configuration);
    const calls = options.calls ?? [];
    return {
      async connect() {
        calls.push("CONNECT");
        if (options.failConnect) throw new Error("secret connection details");
      },
      async query(text: string) {
        calls.push(text.replace(/\s+/g, " ").trim());
        if (options.failMetadata && text.includes("information_schema.tables")) {
          throw new Error("secret query details");
        }
        if (text.includes("information_schema.schemata")) {
          return { rows: options.schemas ?? [{ schema_name: "public" }] };
        }
        if (text.includes("information_schema.tables")) {
          return { rows: options.tables ?? [] };
        }
        return { rows: [] };
      },
      async end() {
        calls.push("END");
      },
    } satisfies DatabaseDiscoveryClient;
  };
}

test("discovers application schemas, tables, and ordered column metadata", async () => {
  const calls: string[] = [];
  const config: Record<string, unknown>[] = [];
  const result = await discoverDatabaseMetadata(trustedServer, "minecore", createClientFactory({
    calls,
    config,
    schemas: [{ schema_name: "app" }, { schema_name: "public" }],
    tables: [
      {
        table_schema: "public",
        table_name: "users",
        table_type: "BASE TABLE",
        column_name: "id",
        ordinal_position: 1,
        data_type: "uuid",
        udt_name: "uuid",
        is_nullable: "NO",
      },
      {
        table_schema: "public",
        table_name: "users",
        table_type: "BASE TABLE",
        column_name: "email",
        ordinal_position: "2",
        data_type: "character varying",
        udt_name: "varchar",
        is_nullable: "YES",
      },
      {
        table_schema: "app",
        table_name: "user_directory",
        table_type: "VIEW",
        column_name: "display_name",
        ordinal_position: 1,
        data_type: "text",
        udt_name: "text",
        is_nullable: "YES",
      },
    ],
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.databaseName, "minecore");
  assert.deepEqual(result.schemas, ["app", "public"]);
  assert.equal(result.tables.length, 2);
  assert.equal(result.tables[0]?.tableName, "user_directory");
  assert.equal(result.tables[0]?.tableType, "VIEW");
  assert.deepEqual(result.tables[1]?.columns, [
    { columnName: "id", ordinalPosition: 1, dataType: "uuid", udtName: "uuid", nullable: false },
    { columnName: "email", ordinalPosition: 2, dataType: "character varying", udtName: "varchar", nullable: true },
  ]);
  assert.equal(config[0]?.database, "minecore");
  assert.equal(config[0]?.host, trustedServer.host);
  assert.ok(calls.includes("BEGIN TRANSACTION READ ONLY"));
  assert.ok(calls.some((call) => call.includes("SET LOCAL statement_timeout")));
  const schemaQuery = calls.find((call) => call.includes("information_schema.schemata"));
  const tableQuery = calls.find((call) => call.includes("information_schema.tables"));
  assert.ok(schemaQuery?.includes("schema_name <> 'information_schema'"));
  assert.ok(schemaQuery?.includes("schema_name NOT LIKE 'pg_%'"));
  assert.ok(tableQuery?.includes("table_schema NOT LIKE 'pg_%'"));
  assert.ok(tableQuery?.includes("c.ordinal_position"));
  assert.ok(calls.includes("COMMIT"));
  assert.equal(calls.at(-1), "END");
  assert.ok(!calls.some((call) => /\bSELECT\s+\*\s+FROM\s+(?!information_schema)/i.test(call)));
});

test("returns a valid empty discovery result when no application objects exist", async () => {
  const result = await discoverDatabaseMetadata(trustedServer, "empty_db", createClientFactory({
    schemas: [],
    tables: [],
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.schemas, []);
  assert.deepEqual(result.tables, []);
});

test("returns a safe connection failure and still closes the client", async () => {
  const calls: string[] = [];
  const result = await discoverDatabaseMetadata(trustedServer, "minecore", createClientFactory({
    calls,
    failConnect: true,
  }));

  assert.deepEqual(result, {
    ok: false,
    code: "CONNECTION_FAILED",
    message: "Unable to connect to the registered database for discovery.",
  });
  assert.ok(calls.includes("END"));
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("returns a safe metadata query failure, rolls back, and closes the client", async () => {
  const calls: string[] = [];
  const result = await discoverDatabaseMetadata(trustedServer, "minecore", createClientFactory({
    calls,
    failMetadata: true,
  }));

  assert.deepEqual(result, {
    ok: false,
    code: "DISCOVERY_FAILED",
    message: "Database metadata discovery failed.",
  });
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.at(-1), "END");
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("rejects invalid timeout configuration without connecting", async () => {
  let factoryCalled = false;
  const result = await discoverDatabaseMetadata(
    { ...trustedServer, connectTimeoutMs: 0 },
    "minecore",
    () => {
      factoryCalled = true;
      throw new Error("must not connect");
    },
  );

  assert.deepEqual(result, {
    ok: false,
    code: "CONFIGURATION_ERROR",
    message: "Trusted database discovery configuration is invalid.",
  });
  assert.equal(factoryCalled, false);
});
