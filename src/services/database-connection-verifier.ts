import { Client } from "pg";
import type { TrustedDatabaseServer } from "../config/database-servers.js";

export type DatabaseVerificationResult = {
  ok: boolean;
  serverKey: string;
  databaseName: string;
  checkedAt: string;
  durationMs: number;
  code:
    | "CONNECTION_OK"
    | "UNKNOWN_SERVER"
    | "CONFIGURATION_ERROR"
    | "CONNECTION_FAILED"
    | "DATABASE_MISMATCH";
  message: string;
};

type ClientLike = {
  connect(): Promise<void>;
  query(
    text: string,
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

type ClientFactory = (
  config: Record<string, unknown>,
) => ClientLike;

const defaultClientFactory: ClientFactory = (config) =>
  new Client(config) as unknown as ClientLike;

export async function verifyDatabaseConnection(
  server: TrustedDatabaseServer,
  databaseName: string,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<DatabaseVerificationResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  let client: ClientLike | undefined;

  const result = (
    ok: boolean,
    code: DatabaseVerificationResult["code"],
    message: string,
  ): DatabaseVerificationResult => ({
    ok,
    serverKey: server.key,
    databaseName,
    checkedAt,
    durationMs: Date.now() - startedAt,
    code,
    message,
  });

  try {
    client = clientFactory({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database: databaseName,
      ssl:
        server.ssl === "require"
          ? { rejectUnauthorized: true }
          : false,
      connectionTimeoutMillis: server.connectTimeoutMs,
      query_timeout: server.connectTimeoutMs,
      application_name: "postgres-project-manager-verifier",
    });

    await client.connect();

    const queryResult = await client.query(
      "SELECT 1 AS connection_ok, current_database() AS database_name",
    );

    const row = queryResult.rows[0];

    if (
      row?.connection_ok !== 1 &&
      row?.connection_ok !== "1"
    ) {
      return result(
        false,
        "CONNECTION_FAILED",
        "The database connection check did not return the expected result.",
      );
    }

    if (row.database_name !== databaseName) {
      return result(
        false,
        "DATABASE_MISMATCH",
        "The connected database does not match the requested database.",
      );
    }

    return result(
      true,
      "CONNECTION_OK",
      "PostgreSQL connection verified successfully.",
    );
  } catch {
    return result(
      false,
      "CONNECTION_FAILED",
      "Could not connect to the target database. Check trusted configuration, database existence, permissions, and network access.",
    );
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Cleanup errors must not expose connection details.
      }
    }
  }
}
