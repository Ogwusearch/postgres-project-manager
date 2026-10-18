import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

const databaseName = process.env.PPM_TEST_DATABASE_NAME;
const configuredDatabase = process.env.PGDATABASE;

function assertSafeTestDatabase(): asserts databaseName is string {
  if (!databaseName || !configuredDatabase) {
    throw new Error(
      "Refusing integration test: explicitly set both " +
      "PPM_TEST_DATABASE_NAME and PGDATABASE to a dedicated test database.",
    );
  }

  if (databaseName !== configuredDatabase) {
    throw new Error(
      "Refusing integration test: PPM_TEST_DATABASE_NAME must equal PGDATABASE.",
    );
  }

  if (!/^ppm_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      "Refusing integration test: database name must match ppm_test_<name>.",
    );
  }

  if (
    databaseName === "platform_control_db" ||
    databaseName === "postgres" ||
    databaseName === "template0" ||
    databaseName === "template1"
  ) {
    throw new Error(
      `Refusing integration test against protected database "${databaseName}".`,
    );
  }
}

const verificationSql = `
  WITH current_instance AS MATERIALIZED (
    SELECT id, status
    FROM public.database_instances
    WHERE id = $1
    FOR UPDATE
  ),
  transitioned AS (
    UPDATE public.database_instances AS di
    SET status = CASE
      WHEN $2::boolean THEN 'ready'
      ELSE 'failed'
    END
    FROM current_instance AS ci
    WHERE di.id = ci.id
      AND di.status = ci.status
      AND ci.status IN ('planned', 'provisioning')
    RETURNING
      di.id,
      ci.status AS status_before,
      di.status AS status_after
  ),
  audit_event AS (
    INSERT INTO public.audit_events
      (id, actor, action, target, outcome, details)
    SELECT
      $3, $4, $5, $6, $7,
      $8::jsonb || jsonb_build_object(
        'status_before', ci.status,
        'status_after', COALESCE(t.status_after, ci.status)
      )
    FROM current_instance AS ci
    LEFT JOIN transitioned AS t ON t.id = ci.id
    RETURNING id
  )
  SELECT COALESCE(t.status_after, ci.status) AS lifecycle_status
  FROM current_instance AS ci
  LEFT JOIN transitioned AS t ON t.id = ci.id
  CROSS JOIN audit_event
`;

test("PostgreSQL verification status and audit are atomic", async () => {
  // Guard runs before any database connection is opened.
  assertSafeTestDatabase();

  const pool = new Pool({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 55432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: databaseName,
    connectionTimeoutMillis: 5000,
    max: 1,
  });

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    // Confirm the server connected us to the explicitly approved database.
    const identity = await client.query(
      "SELECT current_database() AS database_name",
    );

    assert.equal(identity.rows[0]?.database_name, databaseName);

    await client.query("BEGIN");
    transactionOpen = true;

    const projectId = randomUUID();
    const successId = randomUUID();
    const failureId = randomUUID();
    const duplicateAuditId = randomUUID();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);

    await client.query(
      `INSERT INTO public.projects (id, project_key, name)
       VALUES ($1, $2, $3)`,
      [projectId, `atomic-test-${suffix}`, "Atomic verification integration test"],
    );

    await client.query(
      `INSERT INTO public.database_instances
         (id, project_id, environment, database_name, server_key, status)
       VALUES
         ($1, $2, 'development', $3, 'local-postgres', 'planned'),
         ($4, $2, 'staging', $5, 'local-postgres', 'provisioning')`,
      [
        successId,
        projectId,
        `atomic_success_${suffix}`,
        failureId,
        `atomic_failure_${suffix}`,
      ],
    );

    // Successful status transition and matching audit record.
    const success = await client.query(verificationSql, [
      successId,
      true,
      randomUUID(),
      "system",
      "database.connection.verify",
      `database_instance:${successId}`,
      "succeeded",
      JSON.stringify({
        verification_code: "TEST_OK",
        server_key: "local-postgres",
        database_name: `atomic_success_${suffix}`,
        duration_ms: 1,
      }),
    ]);

    assert.equal(success.rows[0]?.lifecycle_status, "ready");

    const successAudit = await client.query(
      `SELECT actor, action, outcome, details
       FROM public.audit_events
       WHERE target = $1
         AND action = 'database.connection.verify'`,
      [`database_instance:${successId}`],
    );

    assert.equal(successAudit.rows.length, 1);
    assert.equal(successAudit.rows[0].actor, "system");
    assert.equal(successAudit.rows[0].outcome, "succeeded");
    assert.equal(successAudit.rows[0].details.status_before, "planned");
    assert.equal(successAudit.rows[0].details.status_after, "ready");

    // Reserve an audit ID to force the next audit insert to fail.
    await client.query(
      `INSERT INTO public.audit_events
         (id, actor, action, target, outcome, details)
       VALUES ($1, 'test', 'test.seed', 'test.seed', 'succeeded', '{}')`,
      [duplicateAuditId],
    );

    await client.query("SAVEPOINT before_expected_failure");

    let expectedError: { code?: string } | undefined;

    try {
      await client.query(verificationSql, [
        failureId,
        true,
        duplicateAuditId,
        "system",
        "database.connection.verify",
        `database_instance:${failureId}`,
        "succeeded",
        JSON.stringify({
          verification_code: "TEST_OK",
          server_key: "local-postgres",
          database_name: `atomic_failure_${suffix}`,
          duration_ms: 1,
        }),
      ]);
    } catch (error) {
      expectedError = error as { code?: string };
    }

    assert.equal(
      expectedError?.code,
      "23505",
      "Expected duplicate audit primary-key failure",
    );

    // Recover from the expected SQL error and inspect the unchanged status.
    await client.query("ROLLBACK TO SAVEPOINT before_expected_failure");

    const unchanged = await client.query(
      `SELECT status
       FROM public.database_instances
       WHERE id = $1`,
      [failureId],
    );

    assert.equal(unchanged.rows[0]?.status, "provisioning");

    const reservedAudit = await client.query(
      `SELECT count(*)::int AS count
       FROM public.audit_events
       WHERE id = $1`,
      [duplicateAuditId],
    );

    assert.equal(reservedAudit.rows[0].count, 1);

    // All project, instance, and audit fixtures are temporary.
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {});
    }

    client.release();
    await pool.end();
  }
});
