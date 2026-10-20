import { config } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { PgSqlExecutor } from "@postgres-project-manager/postgres-admin";

// Load ordinary project configuration first. The external provisioning file
// supplies PROVISION_PG* values without overriding already-set environment.
config();
config({
  path: join(
    homedir(),
    ".config",
    "postgres-project-manager",
    "provision-postgres.env",
  ),
});
import { createApp } from "./app.js";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55433),
  user: process.env.PGUSER ?? "ppm_registry_app",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "platform_control_db",
  connectionTimeoutMillis: 5000,
  max: 10,
});

const executor = new PgSqlExecutor(pool);
const app = createApp(executor);

async function start() {
  try {
    await pool.query("SELECT 1");
    await app.listen({
      host: process.env.API_HOST ?? "127.0.0.1",
      port: Number(process.env.API_PORT ?? 3000),
    });
    app.log.info("PostgreSQL Project Manager API started");
  } catch (error) {
    app.log.error({ err: error }, "API startup failed");
    await pool.end();
    process.exitCode = 1;
  }
}

async function shutdown() {
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});

void start();
