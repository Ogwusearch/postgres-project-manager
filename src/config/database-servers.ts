export type TrustedDatabaseServer = {
  key: string;
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: "disable" | "require";
  connectTimeoutMs: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing trusted server configuration: ${name}`);
  }

  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new Error(`Invalid trusted server configuration: ${name}`);
  }

  return value;
}

function sslEnv(name: string): "disable" | "require" {
  const ssl = process.env[name]?.trim() || "disable";

  if (ssl !== "disable" && ssl !== "require") {
    throw new Error(`Invalid trusted server TLS policy: ${name}`);
  }

  return ssl;
}

/**
 * Resolve target connection credentials by an explicit registry server key.
 *
 * `minecore-postgres` is a read-only connection to Minecore and uses the
 * MINECORE_PG* variables. `local-postgres` points at the same endpoint as the
 * development provisioning server, but uses a separate least-privilege
 * verifier account. The provisioning administrator credentials are never
 * returned for verification or schema discovery.
 */
export function getTrustedDatabaseServer(
  serverKey: string,
): TrustedDatabaseServer {
  if (serverKey === "minecore-postgres") {
    const port = positiveIntegerEnv("MINECORE_PGPORT", 5433);

    if (port > 65535) {
      throw new Error("Invalid trusted server port: MINECORE_PGPORT");
    }

    return {
      key: "minecore-postgres",
      host: requiredEnv("MINECORE_PGHOST"),
      port,
      user: requiredEnv("MINECORE_PGUSER"),
      password: requiredEnv("MINECORE_PGPASSWORD"),
      ssl: sslEnv("MINECORE_PGSSL"),
      connectTimeoutMs: positiveIntegerEnv(
        "MINECORE_PG_CONNECT_TIMEOUT_MS",
        5000,
      ),
    };
  }

  if (serverKey === "local-postgres") {
    // Share the development provisioning endpoint, but not its credentials.
    const port = positiveIntegerEnv("PROVISION_PGPORT", 55434);

    if (port > 65535) {
      throw new Error("Invalid trusted server port: PROVISION_PGPORT");
    }

    return {
      key: "local-postgres",
      host: requiredEnv("PROVISION_PGHOST"),
      port,
      user: requiredEnv("LOCAL_POSTGRES_VERIFY_PGUSER"),
      password: requiredEnv("LOCAL_POSTGRES_VERIFY_PGPASSWORD"),
      ssl: sslEnv("PROVISION_PGSSL"),
      connectTimeoutMs: positiveIntegerEnv(
        "LOCAL_POSTGRES_VERIFY_CONNECT_TIMEOUT_MS",
        3000,
      ),
    };
  }

  throw new Error("Unknown trusted database server.");
}
