import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, type PoolClient } from "pg";

const databaseName = process.env.PPM_TEST_DATABASE_NAME;
const configuredDatabase = process.env.PGDATABASE;

function assertSafeTestDatabase(): asserts databaseName is string {
  if (!databaseName || !configuredDatabase) {
    throw new Error(
      "Refusing integration test: explicitly set PPM_TEST_DATABASE_NAME and PGDATABASE.",
    );
  }

  if (databaseName !== configuredDatabase) {
    throw new Error(
      "Refusing integration test: PPM_TEST_DATABASE_NAME must equal PGDATABASE.",
    );
  }

  if (
    !/^ppm_test_[a-z0-9_]+$/.test(databaseName) ||
    ["platform_control_db", "postgres", "template0", "template1"].includes(
      databaseName,
    )
  ) {
    throw new Error(
      `Refusing integration test against unsafe database "${databaseName}".`,
    );
  }
}

const verificationSql = `
  WITH current_instance AS MATERIALIZED (
    SELECT di.id, di.status
    FROM public.database_instances AS di
    JOIN public.projects AS p ON p.id = di.project_id
    WHERE di.id = $1
      AND p.tenant_id = $9
    FOR UPDATE OF di
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
      AND (
              ci.status IN ('planned', 'provisioning')
              OR (ci.status = 'failed' AND $2::boolean)
            )
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

function verificationParams(
  instanceId: string,
  ok: boolean,
  code: string,
  tenantId: string,
): [string, boolean, string, string, string, string, string, string, string] {
  return [
    instanceId,
    ok,
    randomUUID(),
    "integration-test",
    "database.connection.verify",
    `database_instance:${instanceId}`,
    ok ? "succeeded" : "failed",
    JSON.stringify({ verification_code: code }),
    tenantId,
  ];
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

test(
  "concurrent verification preserves the first transition and audits every request",
  async () => {
    assertSafeTestDatabase();

    const pool = new Pool({
      host: process.env.PGHOST ?? "127.0.0.1",
      port: Number(process.env.PGPORT ?? 55432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: databaseName,
      connectionTimeoutMillis: 5000,
      max: 3,
    });

    let first: PoolClient | undefined;
    let second: PoolClient | undefined;
    let monitor: PoolClient | undefined;
    let auditMonitor: PoolClient | undefined;
    let auditMonitorPool: Pool | undefined;
    let transactionOpen = false;
    let fixtureCreated = false;
    let secondRequest:
      | Promise<{ rows: { lifecycle_status: string }[] }>
      | undefined;

    const projectId = randomUUID();
    const instanceId = randomUUID();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const target = `database_instance:${instanceId}`;

    try {
      first = await pool.connect();
      second = await pool.connect();
      monitor = await pool.connect();

      // Keep the audit observer on the same isolated server as the runtime pool.
      auditMonitorPool = new Pool({
        host: process.env.PGHOST ?? "127.0.0.1",
        port: Number(process.env.PGPORT ?? 55432),
        user: process.env.CONTROL_MIGRATION_USER,
        password: process.env.CONTROL_MIGRATION_PASSWORD,
        database: databaseName,
        connectionTimeoutMillis: 5000,
        max: 1,
      });
      auditMonitor = await auditMonitorPool.connect();

      const identity = await monitor.query(
        "SELECT current_database() AS database_name",
      );
      assert.equal(identity.rows[0]?.database_name, databaseName);

      await first.query(
        "SELECT set_config('application_name', $1, false)",
        ["ppm_atomicity_first"],
      );
      await second.query(
        "SELECT set_config('application_name', $1, false)",
        ["ppm_atomicity_second"],
      );

      const tenant = await first.query<{ id: string }>(
        "SELECT id FROM public.tenants WHERE tenant_key = 'legacy'",
      );
      assert.ok(tenant.rows[0], "Expected the legacy test tenant to exist");
      const tenantId = tenant.rows[0].id;

      await first.query(
        `INSERT INTO public.projects (id, project_key, name, tenant_id)
         VALUES ($1, $2, $3, $4)`,
        [
          projectId,
          `concurrent-test-${suffix}`,
          "Concurrent verification test",
          tenantId,
        ],
      );

      await first.query(
        `INSERT INTO public.database_instances
           (id, project_id, environment, database_name, server_key, status)
         VALUES ($1, $2, 'development', $3, 'local-postgres', 'planned')`,
        [instanceId, projectId, `concurrent_${suffix}`],
      );
      fixtureCreated = true;

      // Hold the first transition open so the second request must wait.
      await first.query("BEGIN");
      transactionOpen = true;

      const firstResult = await first.query<{ lifecycle_status: string }>(
        verificationSql,
        verificationParams(instanceId, true, "FIRST_SUCCESS", tenantId),
      );
      assert.equal(firstResult.rows[0]?.lifecycle_status, "ready");

      secondRequest = second
        .query<{ lifecycle_status: string }>(
          verificationSql,
          verificationParams(instanceId, false, "SECOND_FAILURE", tenantId),
        )
        .then((result) => ({ rows: result.rows }));

      let observedLockWait = false;

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const waiting = await monitor.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE application_name = $1
               AND wait_event_type = 'Lock'
           ) AS waiting`,
          ["ppm_atomicity_second"],
        );

        if (waiting.rows[0]?.waiting) {
          observedLockWait = true;
          break;
        }

        await delay(10);
      }

      assert.equal(
        observedLockWait,
        true,
        "Expected the concurrent verification to wait on the locked instance row",
      );

      // Commit the winner. The waiting request must now see status 'ready'.
      await first.query("COMMIT");
      transactionOpen = false;

      const secondResult = await secondRequest;
      assert.equal(secondResult.rows[0]?.lifecycle_status, "ready");

      // A later failure result must not overwrite the terminal 'ready' status.
      const laterResult = await monitor.query<{ lifecycle_status: string }>(
        verificationSql,
        verificationParams(instanceId, false, "LATER_FAILURE", tenantId),
      );
      assert.equal(laterResult.rows[0]?.lifecycle_status, "ready");

      const finalStatus = await monitor.query<{ status: string }>(
        `SELECT status
         FROM public.database_instances
         WHERE id = $1`,
        [instanceId],
      );
      assert.equal(finalStatus.rows[0]?.status, "ready");

      const auditResult = await auditMonitor!.query<{
        outcome: string;
        details: {
          verification_code: string;
          status_before: string;
          status_after: string;
        };
      }>(
        `SELECT outcome, details
         FROM public.audit_events
         WHERE target = $1
           AND action = 'database.connection.verify'
         ORDER BY details->>'verification_code'`,
        [target],
      );

      assert.equal(
        auditResult.rows.length,
        3,
        "Every verification request must produce its own audit event",
      );

      const audits = new Map(
        auditResult.rows.map((row) => [row.details.verification_code, row]),
      );

      const firstAudit = audits.get("FIRST_SUCCESS");
      assert.ok(firstAudit, "Missing first request audit");
      assert.equal(firstAudit.outcome, "succeeded");
      assert.equal(firstAudit.details.status_before, "planned");
      assert.equal(firstAudit.details.status_after, "ready");

      const secondAudit = audits.get("SECOND_FAILURE");
      assert.ok(secondAudit, "Missing concurrent request audit");
      assert.equal(secondAudit.outcome, "failed");
      assert.equal(secondAudit.details.status_before, "ready");
      assert.equal(secondAudit.details.status_after, "ready");

      const laterAudit = audits.get("LATER_FAILURE");
      assert.ok(laterAudit, "Missing later request audit");
      assert.equal(laterAudit.outcome, "failed");
      assert.equal(laterAudit.details.status_before, "ready");
      assert.equal(laterAudit.details.status_after, "ready");
    } finally {
      if (transactionOpen && first) {
        await first.query("ROLLBACK").catch(() => {});
      }

      if (secondRequest) {
        await secondRequest.catch(() => {});
      }

      if (fixtureCreated && auditMonitor) {
        await auditMonitor.query(
          `DELETE FROM public.audit_events
           WHERE target = $1`,
          [target],
        ).catch(() => {});

        await auditMonitor.query(
          "DELETE FROM public.database_instances WHERE id = $1",
          [instanceId],
        ).catch(() => {});

        await auditMonitor.query(
          "DELETE FROM public.projects WHERE id = $1",
          [projectId],
        ).catch(() => {});
      }

      first?.release();
      second?.release();
      monitor?.release();
      auditMonitor?.release();
      await auditMonitorPool?.end();
      await pool.end();
    }
  },
);
