import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";
import pg, { type PoolClient } from "pg";
import { hashPassword, normalizeEmail } from "../src/services/authentication.js";

config();
config({
  path: join(
    homedir(),
    ".config",
    "postgres-project-manager",
    "provision-postgres.env",
  ),
});
config({ path: ".env.integration.local" });

const { Pool } = pg;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment setting: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const database = requiredEnv("PPM_BOOTSTRAP_DATABASE");
  const confirmation = requiredEnv("PPM_BOOTSTRAP_CONFIRM_DATABASE");
  const enabled = requiredEnv("PPM_BOOTSTRAP_ENABLE");

  if (database !== confirmation) {
    throw new Error("Bootstrap refused: database confirmation does not match.");
  }

  if (enabled !== "CREATE_FIRST_SUPER_ADMIN") {
    throw new Error("Bootstrap refused: explicit confirmation is required.");
  }

  if (!/^[a-z0-9_]{1,63}$/.test(database)) {
    throw new Error("Bootstrap refused: invalid database name.");
  }

  if (database !== "platform_control_db") {
    throw new Error(
      "Bootstrap refused: the first Super Admin may only be created in platform_control_db.",
    );
  }

  if (["postgres", "template0", "template1"].includes(database)) {
    throw new Error("Bootstrap refused: protected database target.");
  }

  const email = normalizeEmail(requiredEnv("PPM_BOOTSTRAP_EMAIL"));
  let password = process.env.PPM_BOOTSTRAP_PASSWORD ?? "";
  delete process.env.PPM_BOOTSTRAP_PASSWORD;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Bootstrap refused: invalid email address.");
  }

  if (password.length < 12 || password.length > 1024) {
    throw new Error("Bootstrap refused: password must be 12–1024 characters.");
  }

  const host = requiredEnv("CONTROL_MIGRATION_HOST");
  const port = Number(process.env.CONTROL_MIGRATION_PORT ?? "55433");
  const user = requiredEnv("CONTROL_MIGRATION_USER");
  const dbPassword = requiredEnv("CONTROL_MIGRATION_PASSWORD");
  const runtimeRole = requiredEnv("PGUSER");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Bootstrap refused: invalid database port.");
  }

  if (user === runtimeRole) {
    throw new Error(
      "Bootstrap refused: use a separate administrative database role, not the runtime role.",
    );
  }

  const pool = new Pool({
    host,
    port,
    user,
    password: dbPassword,
    database,
    connectionTimeoutMillis: 5000,
    max: 1,
    application_name: "ppm-controlled-super-admin-bootstrap",
  });

  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    client = await pool.connect();

    const identity = await client.query<{
      database_name: string;
      role_name: string;
    }>(`
      SELECT current_database() AS database_name,
             current_user AS role_name
    `);

    if (identity.rows[0]?.database_name !== database) {
      throw new Error("Bootstrap refused: connected database does not match.");
    }

    if (identity.rows[0]?.role_name !== user) {
      throw new Error(
        "Bootstrap refused: connected database role does not match the configured administrative role.",
      );
    }

    // Ensure the auth schema exists before performing any writes.
    const schema = await client.query<{ users_table: string | null }>(`
      SELECT to_regclass('public.users')::text AS users_table
    `);

    if (!schema.rows[0]?.users_table) {
      throw new Error(
        "Bootstrap refused: public.users is missing; apply and verify the migration first.",
      );
    }

    const passwordHash = await hashPassword(password);
    password = "";

    await client.query("BEGIN");
    transactionOpen = true;

    // Serialize concurrent bootstrap attempts.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["postgres-project-manager:first-super-admin-bootstrap"],
    );

    const existing = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM public.users
      WHERE is_super_admin = TRUE
    `);

    if (Number(existing.rows[0]?.count ?? "0") > 0) {
      throw new Error(
        "Bootstrap refused: a Super Admin already exists. Use the administrative recovery procedure.",
      );
    }

    const inserted = await client.query<{
      id: string;
      email: string;
      is_super_admin: boolean;
      status: string;
    }>(
      `INSERT INTO public.users
         (id, email, password_hash, is_super_admin, status)
       VALUES ($1, $2, $3, TRUE, 'active')
       RETURNING id, email, is_super_admin, status`,
      [randomUUID(), email, passwordHash],
    );

    if (inserted.rowCount !== 1) {
      throw new Error("Bootstrap failed: Super Admin was not created.");
    }

    await client.query("COMMIT");
    transactionOpen = false;

    console.log("First Super Admin created successfully.");
    console.log(JSON.stringify(inserted.rows[0], null, 2));
    console.log("The password and password hash were not displayed.");
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
    }
    throw error;
  } finally {
    password = "";
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Super Admin bootstrap failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
