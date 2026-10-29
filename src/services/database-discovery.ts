import { Client } from "pg";
import type { TrustedDatabaseServer } from "../config/database-servers.js";

export interface DiscoveredColumn {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  udtName: string;
  nullable: boolean;
}

export interface DiscoveredTable {
  schemaName: string;
  tableName: string;
  tableType: string;
  columns: DiscoveredColumn[];
}

export interface DatabaseDiscoverySuccess {
  ok: true;
  databaseName: string;
  discoveredAt: string;
  schemas: string[];
  tables: DiscoveredTable[];
}

export interface DatabaseDiscoveryFailure {
  ok: false;
  code: "CONNECTION_FAILED" | "DISCOVERY_FAILED" | "CONFIGURATION_ERROR";
  message: string;
}

export type DatabaseDiscoveryResult =
  | DatabaseDiscoverySuccess
  | DatabaseDiscoveryFailure;

export interface DatabaseDiscoveryClient {
  connect(): Promise<void>;
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export type DatabaseDiscoveryClientFactory = (
  configuration: Record<string, unknown>,
) => DatabaseDiscoveryClient;

const defaultClientFactory: DatabaseDiscoveryClientFactory = (configuration) =>
  new Client(configuration) as unknown as DatabaseDiscoveryClient;

const APPLICATION_SCHEMAS_SQL = `
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name <> 'information_schema'
    AND schema_name NOT LIKE 'pg_%'
  ORDER BY schema_name
`;

const TABLE_METADATA_SQL = `
  SELECT
    t.table_schema,
    t.table_name,
    t.table_type,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.udt_name,
    c.is_nullable
  FROM information_schema.tables AS t
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = t.table_schema
   AND c.table_name = t.table_name
  WHERE t.table_schema <> 'information_schema'
    AND t.table_schema NOT LIKE 'pg_%'
    AND t.table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
  ORDER BY t.table_schema, t.table_name, c.ordinal_position
`;

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * Reads PostgreSQL schema metadata only. It deliberately never queries user
 * table contents and runs all metadata queries in a read-only transaction.
 */
export async function discoverDatabaseMetadata(
  server: TrustedDatabaseServer,
  databaseName: string,
  clientFactory: DatabaseDiscoveryClientFactory = defaultClientFactory,
): Promise<DatabaseDiscoveryResult> {
  if (!isPositiveInteger(server.connectTimeoutMs) || server.connectTimeoutMs > 120_000) {
    return {
      ok: false,
      code: "CONFIGURATION_ERROR",
      message: "Trusted database discovery configuration is invalid.",
    };
  }

  let client: DatabaseDiscoveryClient | undefined;
  let connected = false;
  let transactionOpen = false;

  try {
    client = clientFactory({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database: databaseName,
      ssl: server.ssl === "require" ? { rejectUnauthorized: true } : false,
      connectionTimeoutMillis: server.connectTimeoutMs,
      query_timeout: server.connectTimeoutMs,
      application_name: "postgres-project-manager-discovery",
    });

    await client.connect();
    connected = true;

    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    await client.query(`SET LOCAL statement_timeout = '${server.connectTimeoutMs}ms'`);

    const schemaResult = await client.query(APPLICATION_SCHEMAS_SQL);
    const tableResult = await client.query(TABLE_METADATA_SQL);

    const schemas = schemaResult.rows
      .map((row) => row.schema_name)
      .filter((value): value is string => typeof value === "string");

    const tablesByKey = new Map<string, DiscoveredTable>();
    for (const row of tableResult.rows) {
      const schemaName = row.table_schema;
      const tableName = row.table_name;
      const tableType = row.table_type;

      if (
        typeof schemaName !== "string" ||
        typeof tableName !== "string" ||
        typeof tableType !== "string"
      ) {
        continue;
      }

      const key = `${schemaName}\u0000${tableName}`;
      let table = tablesByKey.get(key);
      if (!table) {
        table = { schemaName, tableName, tableType, columns: [] };
        tablesByKey.set(key, table);
      }

      if (
        typeof row.column_name === "string" &&
        (typeof row.ordinal_position === "number" ||
          (typeof row.ordinal_position === "string" && row.ordinal_position.trim() !== ""))
      ) {
        table.columns.push({
          columnName: row.column_name,
          ordinalPosition: Number(row.ordinal_position),
          dataType: typeof row.data_type === "string" ? row.data_type : "unknown",
          udtName: typeof row.udt_name === "string" ? row.udt_name : "unknown",
          nullable: row.is_nullable === "YES",
        });
      }
    }

    await client.query("COMMIT");
    transactionOpen = false;

    const tables = [...tablesByKey.values()].sort((left, right) =>
      left.schemaName.localeCompare(right.schemaName) ||
      left.tableName.localeCompare(right.tableName),
    );
    for (const table of tables) {
      table.columns.sort((left, right) => left.ordinalPosition - right.ordinalPosition);
    }

    return {
      ok: true,
      databaseName,
      discoveredAt: new Date().toISOString(),
      schemas,
      tables,
    };
  } catch {
    return connected
      ? {
          ok: false,
          code: "DISCOVERY_FAILED",
          message: "Database metadata discovery failed.",
        }
      : {
          ok: false,
          code: "CONNECTION_FAILED",
          message: "Unable to connect to the registered database for discovery.",
        };
  } finally {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Do not expose rollback details or mask the original result.
      }
    }

    if (client) {
      try {
        await client.end();
      } catch {
        // Cleanup errors must not leak driver information.
      }
    }

  }
}
