import type { TrustedDatabaseServer } from "./database-servers.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing provisioning configuration: ${name}`);
  }

  return value;
}

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  if (!raw) return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new Error(`Invalid provisioning configuration: ${name}`);
  }

  return value;
}

export function getTrustedProvisioningServer(
  serverKey: string,
): TrustedDatabaseServer {
  if (serverKey !== "local-postgres") {
    throw new Error("Unknown trusted provisioning server.");
  }

  const ssl = process.env.PROVISION_PGSSL?.trim() || "disable";

  if (ssl !== "disable" && ssl !== "require") {
    throw new Error("Invalid provisioning TLS policy.");
  }

  const port = integerEnv("PROVISION_PGPORT", 55434);

  if (port > 65535) {
    throw new Error("Invalid provisioning port.");
  }

  return {
    key: "local-postgres",
    host: requiredEnv("PROVISION_PGHOST"),
    port,
    user: requiredEnv("PROVISION_PGUSER"),
    password: requiredEnv("PROVISION_PGPASSWORD"),
    ssl,
    connectTimeoutMs: integerEnv(
      "PROVISION_PG_CONNECT_TIMEOUT_MS",
      5000,
    ),
  };
}
