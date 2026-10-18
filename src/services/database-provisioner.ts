import { Client } from "pg";
import type { TrustedDatabaseServer } from "../config/database-servers.js";

export type DatabaseProvisioningErrorCode =
  | "DATABASE_ALREADY_EXISTS"
  | "PROVISIONING_FAILED";

export class DatabaseProvisioningError extends Error {
  constructor(
    public readonly code: DatabaseProvisioningErrorCode,
  ) {
    super(
      code === "DATABASE_ALREADY_EXISTS"
        ? "The target database already exists and will not be adopted."
        : "PostgreSQL could not create the target database.",
    );

    this.name = "DatabaseProvisioningError";
  }
}

export async function provisionDatabase(
  server: TrustedDatabaseServer,
  databaseName: string,
): Promise<void> {
  // The registry validator already restricts names to simple identifiers.
  // Quote anyway so the identifier is never interpreted as SQL syntax.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(databaseName)) {
    throw new DatabaseProvisioningError("PROVISIONING_FAILED");
  }

  const client = new Client({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database: process.env.PROVISION_PGDATABASE?.trim() || "postgres",
    ssl: server.ssl === "require"
      ? { rejectUnauthorized: true }
      : false,
    connectionTimeoutMillis: server.connectTimeoutMs,
    query_timeout: server.connectTimeoutMs,
    application_name: "postgres-project-manager-provisioner",
  });

  try {
    await client.connect();

    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1",
      [databaseName],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new DatabaseProvisioningError("DATABASE_ALREADY_EXISTS");
    }

    try {
      await client.query(
        `CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`,
      );
    } catch (error) {
      // A concurrent creator can win after the existence check.
      if ((error as { code?: string }).code === "42P04") {
        throw new DatabaseProvisioningError("DATABASE_ALREADY_EXISTS");
      }

      throw new DatabaseProvisioningError("PROVISIONING_FAILED");
    }
  } catch (error) {
    if (error instanceof DatabaseProvisioningError) {
      throw error;
    }

    // Never propagate connection details, SQL, or credentials.
    throw new DatabaseProvisioningError("PROVISIONING_FAILED");
  } finally {
    await client.end().catch(() => {});
  }
}
