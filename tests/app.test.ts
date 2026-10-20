import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";
import type { DatabaseConnectionVerifier } from "../src/app.js";
import type { DatabaseVerificationResult } from "../src/services/database-connection-verifier.js";

const solarAuditId = "9e69f2e8-300a-4068-9ee2-a5203488d19e";

function createTestPool(options: {
  failAuditInsert?: boolean;
  failProvisioningFinalize?: boolean;
} = {}) {
  const projects: Array<Record<string, unknown>> = [
    {
      id: solarAuditId,
      project_key: "solar-audit",
      name: "SolarAudit",
      status: "active",
      created_at: new Date("2026-10-15T00:00:00.000Z"),
    },
  ];

  const instances: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const pool = {
    async query(sql: string, values: unknown[] = []) {
      const statement = sql.replace(/\s+/g, " ").trim();

      if (statement === "SELECT 1") {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }

      if (statement.startsWith("INSERT INTO public.projects")) {
        const [id, projectKey, name, status] = values;

        if (projects.some((p) => p.project_key === projectKey)) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }

        const row = {
          id,
          project_key: projectKey,
          name,
          status,
          created_at: new Date(),
        };
        projects.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (statement.includes("FROM public.projects WHERE id = $1")) {
        const row = projects.find((p) => p.id === values[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.includes("FROM public.projects") && statement.includes("LIMIT $1 OFFSET $2")) {
        const [limit, offset] = values as number[];
        const rows = [...projects]
          .sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at)),
          )
          .slice(offset, offset + limit);
        return { rows, rowCount: rows.length };
      }

      if (statement.startsWith("/* provisioning-finalize */")) {
        const [
          instanceId,
          nextStatus,
          auditId,
          actor,
          action,
          target,
          outcome,
          detailsJson,
        ] = values;

        const instance = instances.find((item) => item.id === instanceId);

        if (!instance || instance.status !== "provisioning") {
          return { rows: [], rowCount: 0 };
        }

        // Simulate PostgreSQL statement atomicity: neither status nor audit
        // changes if the audit insert fails.
        if (options.failProvisioningFinalize || options.failAuditInsert) {
          throw new Error("Simulated provisioning audit failure");
        }

        const statusBefore = String(instance.status);
        const statusAfter = String(nextStatus);
        const parsedDetails =
          typeof detailsJson === "string"
            ? JSON.parse(detailsJson)
            : detailsJson;

        const auditRow = {
          id: auditId,
          actor,
          action,
          target,
          outcome,
          details: {
            ...(parsedDetails as Record<string, unknown>),
            status_before: statusBefore,
            status_after: statusAfter,
          },
          created_at: new Date(),
        };

        // Apply the status and audit together after all failure checks.
        instance.status = statusAfter;
        auditEvents.push(auditRow);

        return {
          rows: [{ lifecycle_status: statusAfter }],
          rowCount: 1,
        };
      }

      if (statement.startsWith("WITH current_instance AS MATERIALIZED")) {
        const [
          instanceId,
          verificationOk,
          auditId,
          actor,
          action,
          target,
          outcome,
          detailsJson,
        ] = values;

        const instance = instances.find((item) => item.id === instanceId);

        if (!instance) {
          return { rows: [], rowCount: 0 };
        }

        // Simulate statement atomicity: fail before changing either record.
        if (options.failAuditInsert) {
          throw new Error("Simulated audit storage failure");
        }

        const statusBefore = String(instance.status);

        if (statusBefore === "planned" || statusBefore === "provisioning") {
          instance.status = verificationOk ? "ready" : "failed";
        }

        const statusAfter = String(instance.status);
        const parsedDetails =
          typeof detailsJson === "string"
            ? JSON.parse(detailsJson)
            : detailsJson;

        const auditRow = {
          id: auditId,
          actor,
          action,
          target,
          outcome,
          details: {
            ...(parsedDetails as Record<string, unknown>),
            status_before: statusBefore,
            status_after: statusAfter,
          },
          created_at: new Date(),
        };

        auditEvents.push(auditRow);

        return {
          rows: [{ lifecycle_status: statusAfter }],
          rowCount: 1,
        };
      }

      if (statement.startsWith("INSERT INTO public.audit_events")) {
        if (options.failAuditInsert) {
          throw new Error("Simulated audit storage failure");
        }

        const [id, actor, action, target, outcome, details] = values;
        const row = {
          id,
          actor,
          action,
          target,
          outcome,
          details,
          created_at: new Date(),
        };
        auditEvents.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (statement.startsWith("INSERT INTO public.database_instances")) {
        const [id, projectId, environment, databaseName, serverKey, status] =
          values;

        if (!projects.some((p) => p.id === projectId)) {
          throw Object.assign(new Error("foreign key"), { code: "23503" });
        }

        if (
          instances.some(
            (item) =>
              item.database_name === databaseName ||
              (item.project_id === projectId &&
                item.environment === environment),
          )
        ) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }

        const row = {
          id,
          project_id: projectId,
          environment,
          database_name: databaseName,
          server_key: serverKey,
          status,
          created_at: new Date(),
        };
        instances.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (
        statement.startsWith("UPDATE public.database_instances") &&
        statement.includes("SET status = $3")
      ) {
        const [id, expectedStatuses, nextStatus] = values as [
          string,
          string[],
          string,
        ];

        const row = instances.find(
          (item) =>
            item.id === id &&
            expectedStatuses.includes(String(item.status)),
        );

        if (!row) {
          return { rows: [], rowCount: 0 };
        }

        row.status = nextStatus;

        return { rows: [row], rowCount: 1 };
      }

      if (
        statement.includes("FROM public.database_instances") &&
        statement.includes("WHERE id = $1")
      ) {
        const row = instances.find((item) => item.id === values[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.includes("FROM public.database_instances")) {
        const projectId = statement.includes("WHERE project_id = $1")
          ? values[0]
          : undefined;

        const rows = instances.filter(
          (item) => projectId === undefined || item.project_id === projectId,
        );

        return { rows, rowCount: rows.length };
      }

      throw new Error(`Unexpected SQL in test: ${statement}`);
    },
    async end() {},
  };

  return { pool: pool as unknown as SqlExecutor, instances, auditEvents };
}

function setup(
  verifyConnection?: DatabaseConnectionVerifier,
  options: {
    failAuditInsert?: boolean;
    failProvisioningFinalize?: boolean;
    provisionDatabase?: (
      server: import("../src/config/database-servers.js").TrustedDatabaseServer,
      databaseName: string,
    ) => Promise<void>;
    getProvisioningServer?: (
      serverKey: string,
    ) => import("../src/config/database-servers.js").TrustedDatabaseServer;
  } = {},
) {
  const { pool, instances, auditEvents } = createTestPool(options);
  let provisionCalls = 0;

  const app = createApp(pool, {
    verifyConnection,
    provisionDatabase: async (server, databaseName) => {
      provisionCalls += 1;
      await (options.provisionDatabase ?? (async () => {}))(
        server,
        databaseName,
      );
    },
    getProvisioningServer: options.getProvisioningServer ?? ((serverKey) => {
      if (serverKey !== "local-postgres") {
        throw new Error("Unknown trusted provisioning server.");
      }

      return {
        key: "local-postgres",
        host: "127.0.0.1",
        port: 55434,
        user: "test-provisioner",
        password: "test-provisioning-secret",
        ssl: "disable",
        connectTimeoutMs: 3000,
      };
    }),
    getTrustedServer: (serverKey) => {
      if (serverKey !== "local-postgres") {
        throw new Error("Unknown trusted database server.");
      }

      return {
        key: "local-postgres",
        host: "127.0.0.1",
        port: 55432,
        user: "test-user",
        password: "test-password",
        ssl: "disable",
        connectTimeoutMs: 3000,
      };
    },
  });

  return {
    app,
    pool,
    instances,
    auditEvents,
    getProvisionCalls: () => provisionCalls,
  };
}

async function registerTestInstance(app: ReturnType<typeof createApp>) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "development",
      database_name: "solar_audit_verify_test",
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json().data as { id: string; status: string };
}

function verificationResult(
  overrides: Partial<DatabaseVerificationResult> = {},
): DatabaseVerificationResult {
  return {
    ok: true,
    serverKey: "local-postgres",
    databaseName: "solar_audit_verify_test",
    checkedAt: "2026-10-15T12:00:00.000Z",
    durationMs: 4,
    code: "CONNECTION_OK",
    message: "PostgreSQL connection verified successfully.",
    ...overrides,
  };
}

test("health endpoint reports database connected", async () => {
  const { app } = setup();
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    database: "connected",
  });

  await app.close();
});

test("project creation validates input", async () => {
  const { app } = setup();
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      project_key: "bad key",
      name: "Invalid",
      status: "active",
    },
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("duplicate project key returns conflict", async () => {
  const { app } = setup();
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      project_key: "solar-audit",
      name: "Duplicate SolarAudit",
      status: "active",
    },
  });

  assert.equal(response.statusCode, 409);
  await app.close();
});

test("project pagination rejects an out-of-range limit", async () => {
  const { app } = setup();
  const response = await app.inject({
    method: "GET",
    url: "/api/projects?limit=500",
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("registers a database instance for an existing project", async () => {
  const { app } = setup();
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "development",
      database_name: "solar_audit_dev",
    },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();

  assert.equal(body.data.project_id, solarAuditId);
  assert.equal(body.data.database_name, "solar_audit_dev");
  assert.equal(body.data.server_key, "local-postgres");
  assert.equal(body.data.status, "planned");
  assert.ok(body.data.id);

  await app.close();
});

test("rejects client-controlled database instance status", async () => {
  const { app } = setup();

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "development",
      database_name: "solar_audit_status_test",
      status: "ready",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /status is managed by the platform/i);

  await app.close();
});

test("rejects an invalid database environment", async () => {
  const { app } = setup();
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "testing",
      database_name: "solar_audit_test",
    },
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("rejects registration for a missing project", async () => {
  const { app } = setup();
  const missingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${missingId}/database-instances`,
    payload: {
      environment: "development",
      database_name: "orphan_database",
    },
  });

  assert.equal(response.statusCode, 404);
  await app.close();
});

test("lists instances for a project", async () => {
  const { app } = setup();

  await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "development",
      database_name: "solar_audit_dev",
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${solarAuditId}/database-instances`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.length, 1);
  assert.equal(response.json().data[0].database_name, "solar_audit_dev");

  await app.close();
});

test("duplicate database name returns conflict", async () => {
  const { app } = setup();

  const payload = {
    environment: "development",
    database_name: "solar_audit_dev",
  };

  const first = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload,
  });

  const second = await app.inject({
    method: "POST",
    url: `/api/projects/${solarAuditId}/database-instances`,
    payload: {
      environment: "staging",
      database_name: "solar_audit_dev",
    },
  });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 409);
  await app.close();
});


test("successful verification transitions a planned instance to ready", async () => {
  const verifier: DatabaseConnectionVerifier = async (server, databaseName) => {
    assert.equal(server.key, "local-postgres");
    assert.equal(databaseName, "solar_audit_verify_test");
    return verificationResult();
  };

  const { app, instances, auditEvents } = setup(verifier);
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/verify`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.ok, true);
  assert.equal(response.json().data.code, "CONNECTION_OK");
  assert.equal(response.json().data.lifecycleStatus, "ready");
  assert.equal(instances[0]?.status, "ready");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.action, "database.connection.verify");
  assert.equal(auditEvents[0]?.outcome, "succeeded");
  assert.equal(auditEvents[0]?.target, `database_instance:${instance.id}`);

  await app.close();
});

test("verification records a failed audit event when target connection fails", async () => {
  const verifier: DatabaseConnectionVerifier = async () =>
    verificationResult({
      ok: false,
      code: "CONNECTION_FAILED",
      message: "Could not connect to the target database.",
    });

  const { app, instances, auditEvents } = setup(verifier);
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/verify`,
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().data.ok, false);
  assert.equal(response.json().data.code, "CONNECTION_FAILED");
  assert.equal(response.json().data.lifecycleStatus, "failed");
  assert.equal(instances[0]?.status, "failed");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.outcome, "failed");

  await app.close();
});

test("verification rejects an invalid instance UUID", async () => {
  const { app, auditEvents } = setup();

  const response = await app.inject({
    method: "POST",
    url: "/api/database-instances/not-a-uuid/verify",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(auditEvents.length, 0);

  await app.close();
});

test("verification returns not found for an unregistered instance", async () => {
  const { app, auditEvents } = setup();

  const response = await app.inject({
    method: "POST",
    url: "/api/database-instances/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/verify",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(auditEvents.length, 0);

  await app.close();
});

test("verification returns 500 when the audit event cannot be recorded", async () => {
  const { app, instances, auditEvents } = setup(
    async () => verificationResult(),
    { failAuditInsert: true },
  );

  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/verify`,
  });

  assert.equal(response.statusCode, 500);
  assert.equal(
    response.json().error,
    "Unable to record database verification and update lifecycle status.",
  );
  assert.equal(instances[0]?.status, "planned");
  assert.equal(auditEvents.length, 0);

  await app.close();
});


// permanent atomic verification HTTP regression
test("verification HTTP response and audit expose matching lifecycle statuses", async () => {
  const verifier: DatabaseConnectionVerifier = async () =>
    verificationResult();

  const { app, instances, auditEvents } = setup(verifier);
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/verify`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.lifecycleStatus, "ready");
  assert.equal(instances[0]?.status, "ready");
  assert.equal(auditEvents.length, 1);

  const audit = auditEvents[0]!;
  const details = audit.details as Record<string, unknown>;

  assert.equal(audit.action, "database.connection.verify");
  assert.equal(audit.outcome, "succeeded");
  assert.equal(details.status_before, "planned");
  assert.equal(details.status_after, "ready");

  await app.close();
});


test("provisions a planned development database and records its audit", async () => {
  const { app, instances, auditEvents, getProvisionCalls } = setup();
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.status, "ready");
  assert.equal(response.json().data.database_name, "solar_audit_verify_test");
  assert.equal(getProvisionCalls(), 1);
  assert.equal(instances[0]?.status, "ready");

  const audit = auditEvents.find(
    (event) => event.action === "database.provision",
  );
  assert.ok(audit);
  assert.equal(audit.outcome, "succeeded");
  assert.equal(
    (audit.details as Record<string, unknown>).status_before,
    "provisioning",
  );
  assert.equal(
    (audit.details as Record<string, unknown>).status_after,
    "ready",
  );
  assert.equal(
    JSON.stringify(audit).includes("test-provisioning-secret"),
    false,
  );

  await app.close();
});

test("provisioning rejects an invalid instance UUID", async () => {
  const { app, getProvisionCalls } = setup();

  const response = await app.inject({
    method: "POST",
    url: "/api/database-instances/not-a-uuid/provision",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(getProvisionCalls(), 0);
  await app.close();
});

test("provisioning returns not found for a missing instance", async () => {
  const { app, getProvisionCalls } = setup();

  const response = await app.inject({
    method: "POST",
    url: "/api/database-instances/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/provision",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(getProvisionCalls(), 0);
  await app.close();
});

test("provisioning rejects staging and production without calling PostgreSQL", async () => {
  for (const environment of ["staging", "production"]) {
    const { app, instances, getProvisionCalls } = setup();
    const instance = await registerTestInstance(app);
    instances[0]!.environment = environment;

    const response = await app.inject({
      method: "POST",
      url: `/api/database-instances/${instance.id}/provision`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(getProvisionCalls(), 0);
    assert.equal(instances[0]?.status, "planned");
    await app.close();
  }
});

test("existing target database is not adopted and is audited as failed", async () => {
  const { app, instances, auditEvents, getProvisionCalls } = setup(
    undefined,
    {
      provisionDatabase: async () => {
        const { DatabaseProvisioningError } = await import(
          "../src/services/database-provisioner.js"
        );
        throw new DatabaseProvisioningError("DATABASE_ALREADY_EXISTS");
      },
    },
  );

  const instance = await registerTestInstance(app);
  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().data, undefined);
  assert.equal(instances[0]?.status, "failed");
  assert.equal(getProvisionCalls(), 1);

  const audit = auditEvents.find(
    (event) => event.action === "database.provision",
  );
  assert.ok(audit);
  assert.equal(audit.outcome, "failed");
  assert.equal(
    (audit.details as Record<string, unknown>).error_code,
    "DATABASE_ALREADY_EXISTS",
  );

  await app.close();
});

test("failed provisioning records a failed lifecycle and audit", async () => {
  const { app, instances, auditEvents } = setup(undefined, {
    provisionDatabase: async () => {
      throw new Error("Sensitive database connection details");
    },
  });
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().lifecycleStatus, "failed");
  assert.doesNotMatch(response.body, /Sensitive database connection details/);
  assert.equal(instances[0]?.status, "failed");

  const audit = auditEvents.find(
    (event) => event.action === "database.provision",
  );
  assert.ok(audit);
  assert.equal(audit.outcome, "failed");
  assert.equal(
    (audit.details as Record<string, unknown>).error_code,
    "PROVISIONING_FAILED",
  );

  await app.close();
});

test("a second provisioning request cannot invoke the provisioner again", async () => {
  const { app, instances, getProvisionCalls } = setup();
  const instance = await registerTestInstance(app);

  // Simulate an abandoned or in-progress operation.
  instances[0]!.status = "provisioning";

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(getProvisionCalls(), 0);
  assert.equal(instances[0]?.status, "provisioning");

  await app.close();
});

test("provisioning finalization failure requires recovery and does not retry creation", async () => {
  const { app, instances, auditEvents, getProvisionCalls } = setup(
    undefined,
    { failProvisioningFinalize: true },
  );
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().recovery_required, true);
  assert.equal(response.json().lifecycleStatus, "provisioning");
  assert.equal(instances[0]?.status, "provisioning");
  assert.equal(getProvisionCalls(), 1);
  assert.equal(
    auditEvents.some((event) => event.action === "database.provision"),
    false,
  );

  const retry = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(retry.statusCode, 409);
  assert.equal(getProvisionCalls(), 1);

  await app.close();
});

test("provisioning configuration failure does not claim the instance", async () => {
  const { app, instances, getProvisionCalls } = setup(undefined, {
    getProvisioningServer: () => {
      throw new Error("Sensitive configuration detail");
    },
  });
  const instance = await registerTestInstance(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/database-instances/${instance.id}/provision`,
  });

  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /Sensitive configuration detail/);
  assert.equal(instances[0]?.status, "planned");
  assert.equal(getProvisionCalls(), 0);

  await app.close();
});
