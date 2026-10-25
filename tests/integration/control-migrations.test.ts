import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "pg";

const expectedDatabase = "ppm_test_control_migrations_disposable_20261019";
const database = process.env.CONTROL_MIGRATION_DATABASE;
const user = process.env.CONTROL_MIGRATION_USER;
const password = process.env.CONTROL_MIGRATION_PASSWORD;
const host = process.env.CONTROL_MIGRATION_HOST;
const port = Number(process.env.CONTROL_MIGRATION_PORT ?? "55433");



const root = process.cwd();
const runner = resolve(root, "scripts/control-migrations.mjs");
const lockKeys = [73198420, 11235813];

function assertSafeTarget(): void {
  assert.equal(
    process.env.CONTROL_MIGRATION_ALLOW_SCHEMA_RESET,
    "1",
    "Refusing to run destructive integration tests without CONTROL_MIGRATION_ALLOW_SCHEMA_RESET=1",
  );
  assert.equal(
    database,
    expectedDatabase,
    "Refusing to run: CONTROL_MIGRATION_DATABASE must equal the dedicated test database",
  );
  assert.equal(
    user,
    "ppm_control_migration_test",
    "Refusing to run: CONTROL_MIGRATION_USER must be the dedicated non-superuser test role",
  );
  assert.ok(user, "CONTROL_MIGRATION_USER is required");
  assert.ok(password, "CONTROL_MIGRATION_PASSWORD is required");
  assert.ok(host, "CONTROL_MIGRATION_HOST is required");
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535);
  assert.notEqual(database, "platform_control_db");
  assert.notEqual(database, "ppm_test_verification");
}

function connectionOptions() {
  assertSafeTarget();

  return {
    host,
    port,
    database,
    user,
    password,
    connectionTimeoutMillis: 5000,
    application_name: "ppm-control-migration-integration-test",
  };
}

function startRunner(args: string[] = [], cwd = root) {
  const child = spawn(process.execPath, [runner, ...args], {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });

  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolveResult({ code, stdout, stderr });
    });
  });

  return { child, done };
}

async function runRunner(args: string[] = [], cwd = root) {
  return startRunner(args, cwd).done;
}

async function resetPublicSchema(client: Client): Promise<void> {
  const identity = await client.query<{
    database_name: string;
    role_name: string;
  }>(`
    SELECT current_database() AS database_name,
           current_user AS role_name
  `);

  assert.equal(identity.rows[0]?.database_name, expectedDatabase);
  assert.equal(identity.rows[0]?.role_name, user);

  // This is permitted only because the database name and role were checked
  // above. Never point this test at an application or production database.
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
}

async function historyCount(client: Client): Promise<number> {
  const result = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM public.control_schema_migrations
  `);
  return result.rows[0].count;
}

async function waitForTwoLockWaiters(
  client: Client,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE application_name = 'ppm-control-migration-runner'
        AND wait_event_type = 'Lock'
    `);

    if (result.rows[0].count >= 2) return true;

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }

  return false;
}

test(
  "control migration runner: initialization, recovery, baseline, drift, and concurrency",
  { skip: !process.env.CONTROL_MIGRATION_DATABASE },
  async () => {
    assertSafeTarget();

    const client = new Client(connectionOptions());
    await client.connect();

    let externalLockHeld = false;
    let firstConcurrent: ReturnType<typeof startRunner> | undefined;
    let secondConcurrent: ReturnType<typeof startRunner> | undefined;
    let tempDirectory: string | undefined;

    try {
      const identity = await client.query<{
        database_name: string;
        role_name: string;
      }>(`
        SELECT current_database() AS database_name,
               current_user AS role_name
      `);

      assert.equal(identity.rows[0]?.database_name, expectedDatabase);
      assert.equal(identity.rows[0]?.role_name, user);

      // 1. Fresh initialization.
      await resetPublicSchema(client);

      const fresh = await runRunner();
      assert.equal(fresh.code, 0, fresh.stderr);
      assert.match(fresh.stdout, /Applied: 001_initial_registry\.sql/);
      assert.match(fresh.stdout, /Applied: 002_auth_and_tenancy\.sql/);

      const tables = await client.query<{ tablename: string }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);

      assert.deepEqual(
        tables.rows.map((row) => row.tablename),
        [
          "audit_events",
          "auth_sessions",
          "backup_runs",
          "control_schema_migrations",
          "database_instances",
          "migration_runs",
          "project_assignments",
          "projects",
          "tenant_memberships",
          "tenants",
          "users",
        ],
      );
      assert.equal(await historyCount(client), 2);

      // Verify the database enforces tenant-scoped ownership.
      const tenantColumn = await client.query<{ attnotnull: boolean }>(`
        SELECT a.attnotnull
        FROM pg_attribute a
        WHERE a.attrelid = 'public.projects'::regclass
          AND a.attname = 'tenant_id'
          AND NOT a.attisdropped
      `);
      assert.equal(
        tenantColumn.rows[0]?.attnotnull,
        true,
        "projects.tenant_id must be NOT NULL",
      );

      const tenantConstraints = await client.query<{
        constraint_name: string;
        definition: string;
      }>(`
        SELECT c.conname AS constraint_name,
               pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        WHERE c.conrelid IN (
          'public.projects'::regclass,
          'public.tenant_memberships'::regclass,
          'public.project_assignments'::regclass
        )
          AND c.conname IN (
            'projects_id_tenant_id_unique',
            'tenant_memberships_user_tenant_id_unique',
            'project_assignments_user_tenant_fkey',
            'project_assignments_project_tenant_fkey'
          )
        ORDER BY c.conname
      `);




      assert.deepEqual(
        tenantConstraints.rows.map((row) => row.constraint_name),
        [
          "project_assignments_project_tenant_fkey",
          "project_assignments_user_tenant_fkey",
          "projects_id_tenant_id_unique",
          "tenant_memberships_user_tenant_id_unique",
        ],
      );

      const constraintDefinitions = new Map(
        tenantConstraints.rows.map((row) => [
          row.constraint_name,
          row.definition,
        ]),
      );

      assert.match(
        constraintDefinitions.get("projects_id_tenant_id_unique") ?? "",
        /UNIQUE \(id, tenant_id\)/,
      );
      assert.match(
        constraintDefinitions.get("tenant_memberships_user_tenant_id_unique") ?? "",
        /UNIQUE \(user_id, tenant_id\)/,
      );
      assert.match(
        constraintDefinitions.get("project_assignments_user_tenant_fkey") ?? "",
        /FOREIGN KEY \(user_id, tenant_id\).*tenant_memberships\(user_id, tenant_id\)/,
      );
      assert.match(
        constraintDefinitions.get("project_assignments_project_tenant_fkey") ?? "",
        /FOREIGN KEY \(project_id, tenant_id\).*projects\(id, tenant_id\)/,
      );

      // Verify the legacy tenant is created exactly once.
      const legacyTenant = await client.query<{
        tenant_key: string;
        name: string;
        status: string;
      }>(`
        SELECT tenant_key, name, status
        FROM public.tenants
        WHERE tenant_key = 'legacy'
      `);

      assert.deepEqual(legacyTenant.rows, [
        {
          tenant_key: "legacy",
          name: "Legacy Tenant (existing projects)",
          status: "active",
        },
      ]);

      // Verify authentication schema constraints exist.
      const authConstraints = await client.query<{
        conname: string;
        definition: string;
      }>(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid IN (
          'public.tenants'::regclass,
          'public.users'::regclass,
          'public.tenant_memberships'::regclass,
          'public.auth_sessions'::regclass
        )
        ORDER BY conname
      `);

      const authDefinitions = new Map(
        authConstraints.rows.map((row) => [
          row.conname,
          row.definition,
        ]),
      );

      for (const name of [
        "tenants_status_check",
        "tenants_key_format_check",
        "tenants_name_nonempty_check",
        "users_email_normalized_check",
        "users_password_hash_length_check",
        "users_status_check",
        "tenant_memberships_role_check",
        "auth_sessions_token_hash_check",
        "auth_sessions_csrf_hash_check",
        "auth_sessions_expiry_check",
        "auth_sessions_last_seen_check",
        "auth_sessions_revocation_check",
      ]) {
        assert.ok(
          authDefinitions.has(name),
          `Expected authentication constraint: ${name}`,
        );
      }

      // Confirm the super-admin privilege is not granted by default.
      const userDefaults = await client.query<{
        column_default: string | null;
      }>(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'is_super_admin'
      `);

      assert.equal(userDefaults.rows[0]?.column_default, "false");

      // 2. Re-running is idempotent.
      const repeated = await runRunner();
      assert.equal(repeated.code, 0, repeated.stderr);
      assert.match(repeated.stdout, /Already applied: 001_initial_registry\.sql/);
      assert.match(repeated.stdout, /Already applied: 002_auth_and_tenancy\.sql/);
      assert.equal(await historyCount(client), 2);

      // 3. Checksum drift must be rejected.
      await client.query(`
        UPDATE public.control_schema_migrations
        SET checksum_sha256 = repeat('0', 64)
        WHERE version = '001'
      `);

      const drift = await runRunner();
      assert.notEqual(drift.code, 0);
      assert.match(drift.stderr, /checksum or filename mismatch/);

      // 4. A version gap must be rejected.
      await client.query(`
        UPDATE public.control_schema_migrations
        SET version = '003', filename = '003_missing_migration.sql'
        WHERE version = '001'
      `);

      const gap = await runRunner();
      assert.notEqual(gap.code, 0);
      assert.match(gap.stderr, /Applied migration file is missing/);

      // 5. Baseline is explicit and does not re-execute migration SQL.
      await resetPublicSchema(client);

      // Create only the legacy schema represented by migration 001.
      const initialMigration = await readFile(
        resolve(root, "database/control-migrations/001_initial_registry.sql"),
        "utf8",
      );
      await client.query(initialMigration);

      const implicitBaseline = await runRunner();
      assert.notEqual(implicitBaseline.code, 0);
      assert.match(
        implicitBaseline.stderr,
        /use --baseline-existing explicitly/,
      );
      assert.equal(
        (await client.query(
          "SELECT to_regclass('public.control_schema_migrations') AS name",
        )).rows[0].name,
        null,
      );

      // Explicit baseline records 001 and applies migration 002.
      const explicitBaseline = await runRunner(["--baseline-existing"]);
      assert.equal(explicitBaseline.code, 0, explicitBaseline.stderr);
      assert.match(
        explicitBaseline.stdout,
        /Baselined 001_initial_registry\.sql/,
      );
      assert.match(
        explicitBaseline.stdout,
        /Applied: 002_auth_and_tenancy\.sql/,
      );
      assert.equal(await historyCount(client), 2);

      // 6. History without registry tables must be rejected.
      await resetPublicSchema(client);
      await client.query(`
        CREATE TABLE public.control_schema_migrations (version text)
      `);

      const inconsistent = await runRunner();
      assert.notEqual(inconsistent.code, 0);
      assert.match(inconsistent.stderr, /history exists without registry tables/);

      // 7. A failing migration must roll back its DDL and history table.
      await resetPublicSchema(client);

      tempDirectory = await mkdtemp(join(tmpdir(), "ppm-control-migration-"));
      const migrationDirectory = join(
        tempDirectory,
        "database",
        "control-migrations",
      );
      await mkdir(migrationDirectory, { recursive: true });

      await writeFile(
        join(migrationDirectory, "001_failure_test.sql"),
        [
          "BEGIN;",
          "CREATE TABLE public.should_rollback (id integer);",
          "SELECT 1 / 0;",
          "COMMIT;",
          "",
        ].join("\n"),
      );

      const failed = await runRunner([], tempDirectory);
      assert.notEqual(failed.code, 0);
      assert.match(failed.stderr, /division by zero/);

      const rollbackState = await client.query<{
        registry: string | null;
        history: string | null;
      }>(`
        SELECT
          to_regclass('public.should_rollback')::text AS registry,
          to_regclass('public.control_schema_migrations')::text AS history
      `);

      assert.equal(rollbackState.rows[0].registry, null);
      assert.equal(rollbackState.rows[0].history, null);

      // 8. Two simultaneous runners must serialize through the advisory lock.
      await resetPublicSchema(client);

      await client.query(
        "SELECT pg_advisory_lock($1, $2)",
        lockKeys,
      );
      externalLockHeld = true;

      firstConcurrent = startRunner();
      secondConcurrent = startRunner();

      const bothWaited = await waitForTwoLockWaiters(client);

      // Always release the lock before asserting or awaiting child processes.
      await client.query(
        "SELECT pg_advisory_unlock($1, $2)",
        lockKeys,
      );
      externalLockHeld = false;

      assert.equal(
        bothWaited,
        true,
        "Expected both runner processes to wait for the advisory lock",
      );

      const [firstResult, secondResult] = await Promise.all([
        firstConcurrent.done,
        secondConcurrent.done,
      ]);

      assert.equal(firstResult.code, 0, firstResult.stderr);
      assert.equal(secondResult.code, 0, secondResult.stderr);
      assert.equal(await historyCount(client), 2);

      const finalTables = await client.query<{ tablename: string }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);

      assert.deepEqual(
        finalTables.rows.map((row) => row.tablename),
        [
          "audit_events",
          "auth_sessions",
          "backup_runs",
          "control_schema_migrations",
          "database_instances",
          "migration_runs",
          "project_assignments",
          "projects",
          "tenant_memberships",
          "tenants",
          "users",
        ],
      );
    } finally {
      if (externalLockHeld) {
        await client.query(
          "SELECT pg_advisory_unlock($1, $2)",
          lockKeys,
        ).catch(() => {});
      }

      // Do not leave child processes behind if an assertion fails.
      for (const run of [firstConcurrent, secondConcurrent]) {
        if (run && run.child.exitCode === null && !run.child.killed) {
          run.child.kill("SIGTERM");
        }
      }

      await Promise.all([
        firstConcurrent?.done.catch(() => undefined),
        secondConcurrent?.done.catch(() => undefined),
      ]);

      if (tempDirectory) {
        await rm(tempDirectory, { recursive: true, force: true });
      }

      await client.end();
    }
  },
);
