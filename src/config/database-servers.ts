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

export function getTrustedDatabaseServer(
  serverKey: string,
): TrustedDatabaseServer {
  if (serverKey !== "local-postgres") {
    throw new Error("Unknown trusted database server.");
  }

  const ssl = process.env.TARGET_PGSSL?.trim() || "disable";

  if (ssl !== "disable" && ssl !== "require") {
    throw new Error("Invalid trusted server TLS policy.");
  }

  const port = positiveIntegerEnv("TARGET_PGPORT", 55432);

  if (port > 65535) {
    throw new Error("Invalid trusted server port.");
  }

  return {
    key: "local-postgres",
    host: requiredEnv("TARGET_PGHOST"),
    port,
    user: requiredEnv("TARGET_PGUSER"),
    password: requiredEnv("TARGET_PGPASSWORD"),
    ssl,
    connectTimeoutMs: positiveIntegerEnv(
      "TARGET_PG_CONNECT_TIMEOUT_MS",
      3000,
    ),
  };
}
