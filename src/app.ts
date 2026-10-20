import Fastify from "fastify";
import {
  getTrustedDatabaseServer,
  type TrustedDatabaseServer,
} from "./config/database-servers.js";
import {
  verifyDatabaseConnection,
  type DatabaseVerificationResult,
} from "./services/database-connection-verifier.js";
import { getTrustedProvisioningServer } from "./config/provisioning-server.js";
import {
  DatabaseProvisioningError,
  provisionDatabase,
} from "./services/database-provisioner.js";
import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";
import { createProjectRepository } from "./repositories/project.repository.js";
import {
  createDatabaseInstanceRepository,
  type DatabaseInstance,
} from "./repositories/database-instance.repository.js";
import {
  buildCreateProjectInput,
  validateProjectInput,
} from "./services/project.service.js";
import {
  buildCreateDatabaseInstanceInput,
  validateDatabaseInstanceInput,
} from "./services/database-instance.service.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid request.";
}

export type DatabaseConnectionVerifier = (
  server: TrustedDatabaseServer,
  databaseName: string,
) => Promise<DatabaseVerificationResult>;

export type DatabaseProvisioner = (
  server: TrustedDatabaseServer,
  databaseName: string,
) => Promise<void>;

export interface CreateAppOptions {
  verifyConnection?: DatabaseConnectionVerifier;
  getTrustedServer?: (serverKey: string) => TrustedDatabaseServer;
  provisionDatabase?: DatabaseProvisioner;
  getProvisioningServer?: (serverKey: string) => TrustedDatabaseServer;
}

export function createApp(executor: SqlExecutor, options: CreateAppOptions = {}) {
  const app = Fastify({ logger: false });
  const projects = createProjectRepository(executor);
  const instances = createDatabaseInstanceRepository(executor);

  const verifyConnection =
    options.verifyConnection ?? verifyDatabaseConnection;
  const resolveTrustedServer =
    options.getTrustedServer ?? getTrustedDatabaseServer;
  const provision = options.provisionDatabase ?? provisionDatabase;
  const resolveProvisioningServer =
    options.getProvisioningServer ?? getTrustedProvisioningServer;

  app.get("/health", async (_request, reply) => {
    try {
      await executor.query("SELECT 1");
      return { status: "ok", database: "connected" };
    } catch {
      return reply.code(503).send({
        status: "error",
        database: "unavailable",
      });
    }
  });

  app.post("/api/projects", async (request, reply) => {
    let input;

    try {
      input = validateProjectInput(request.body);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }

    try {
      const project = await projects.create(buildCreateProjectInput(input));
      return reply.code(201).send({ data: project });
    } catch (error) {
      const databaseError = error as { code?: string };

      if (databaseError.code === "23505") {
        return reply.code(409).send({
          error: "A project with this project_key already exists.",
        });
      }

      request.log.error({ err: error }, "Failed to register project");
      return reply.code(500).send({
        error: "Unable to register project.",
      });
    }
  });

  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>("/api/projects", async (request, reply) => {
    const limit = Number(request.query.limit ?? 50);
    const offset = Number(request.query.offset ?? 0);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      return reply.code(400).send({
        error: "limit must be 1-100 and offset must be a non-negative integer.",
      });
    }

    try {
      const data = await projects.list(limit, offset);
      return { data, pagination: { limit, offset, count: data.length } };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list projects");
      return reply.code(500).send({
        error: "Unable to retrieve projects.",
      });
    }
  });

  app.post<{
    Params: { projectId: string };
  }>("/api/projects/:projectId/database-instances", async (request, reply) => {
    const { projectId } = request.params;

    if (!isUuid(projectId)) {
      return reply.code(400).send({ error: "projectId must be a valid UUID." });
    }

    let input;

    try {
      input = validateDatabaseInstanceInput(request.body);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }

    try {
      const project = await projects.getById(projectId);

      if (!project) {
        return reply.code(404).send({ error: "Project not found." });
      }

      const data = await instances.create(
        buildCreateDatabaseInstanceInput(projectId, input),
      );

      return reply.code(201).send({ data });
    } catch (error) {
      const databaseError = error as { code?: string };

      if (databaseError.code === "23505") {
        return reply.code(409).send({
          error:
            "A database instance already uses this database name or project environment.",
        });
      }

      if (databaseError.code === "23503") {
        return reply.code(404).send({ error: "Project not found." });
      }

      request.log.error({ err: error }, "Failed to register database instance");
      return reply.code(500).send({
        error: "Unable to register database instance.",
      });
    }
  });

  app.get<{
    Params: { projectId: string };
  }>("/api/projects/:projectId/database-instances", async (request, reply) => {
    const { projectId } = request.params;

    if (!isUuid(projectId)) {
      return reply.code(400).send({ error: "projectId must be a valid UUID." });
    }

    try {
      const project = await projects.getById(projectId);

      if (!project) {
        return reply.code(404).send({ error: "Project not found." });
      }

      return { data: await instances.list(projectId) };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list project database instances");
      return reply.code(500).send({
        error: "Unable to retrieve database instances.",
      });
    }
  });

  app.get<{
    Querystring: { project_id?: string };
  }>("/api/database-instances", async (request, reply) => {
    const projectId = request.query.project_id;

    if (projectId !== undefined && !isUuid(projectId)) {
      return reply.code(400).send({
        error: "project_id must be a valid UUID.",
      });
    }

    try {
      if (projectId) {
        const project = await projects.getById(projectId);

        if (!project) {
          return reply.code(404).send({ error: "Project not found." });
        }
      }

      return { data: await instances.list(projectId) };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list database instances");
      return reply.code(500).send({
        error: "Unable to retrieve database instances.",
      });
    }
  });


  app.post<{
    Params: { id: string };
  }>("/api/database-instances/:id/provision", async (request, reply) => {
    const { id } = request.params;

    if (!isUuid(id)) {
      return reply.code(400).send({
        error: "id must be a valid UUID.",
      });
    }

    let instance: DatabaseInstance | null;

    try {
      instance = await instances.getById(id);
    } catch (error) {
      request.log.error({ err: error }, "Failed to retrieve database instance");
      return reply.code(500).send({
        error: "Unable to retrieve database instance.",
      });
    }

    if (!instance) {
      return reply.code(404).send({
        error: "Database instance not found.",
      });
    }

    // This initial slice deliberately excludes staging and production.
    if (instance.environment !== "development") {
      return reply.code(409).send({
        error: "Only development database instances can be provisioned.",
      });
    }

    let server: TrustedDatabaseServer;

    try {
      // This resolver uses PROVISION_PG* configuration, never TARGET_PG*.
      server = resolveProvisioningServer(instance.server_key);
    } catch {
      return reply.code(503).send({
        error: "Trusted provisioning configuration is unavailable or invalid.",
      });
    }

    // Atomic compare-and-set: only a planned instance can be claimed.
    let claimed: DatabaseInstance | null;

    try {
      claimed = await instances.transitionStatus(
        id,
        ["planned"],
        "provisioning",
      );
    } catch (error) {
      request.log.error({ err: error }, "Failed to claim database provisioning");
      return reply.code(500).send({
        error: "Unable to claim database instance for provisioning.",
      });
    }

    if (!claimed) {
      return reply.code(409).send({
        error: "Database instance is not in the planned state and cannot be provisioned.",
      });
    }

    let provisioningErrorCode:
      | "DATABASE_ALREADY_EXISTS"
      | "PROVISIONING_FAILED"
      | undefined;

    try {
      await provision(server, claimed.database_name);
    } catch (error) {
      provisioningErrorCode =
        error instanceof DatabaseProvisioningError
          ? error.code
          : "PROVISIONING_FAILED";
    }

    const succeeded = provisioningErrorCode === undefined;
    const nextStatus = succeeded ? "ready" : "failed";
    const auditOutcome = succeeded ? "succeeded" : "failed";

    // The status transition and its audit record are one SQL statement.
    // If this fails after CREATE DATABASE succeeded, the claim remains
    // provisioning. Do not retry CREATE DATABASE automatically.
    let finalized = false;

    try {
      const result = await executor.query(
        `
        /* provisioning-finalize */
        WITH current_instance AS MATERIALIZED (
          SELECT id, status
          FROM public.database_instances
          WHERE id = $1
          FOR UPDATE
        ),
        transitioned AS (
          UPDATE public.database_instances AS di
          SET status = $2
          FROM current_instance AS ci
          WHERE di.id = ci.id
            AND ci.status = 'provisioning'
          RETURNING
            di.id,
            ci.status AS status_before,
            di.status AS status_after
        ),
        audit_event AS (
          INSERT INTO public.audit_events
            (id, actor, action, target, outcome, details)
          SELECT
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::jsonb || jsonb_build_object(
              'status_before', t.status_before,
              'status_after', t.status_after
            )
          FROM transitioned AS t
          RETURNING id
        )
        SELECT t.status_after AS lifecycle_status
        FROM transitioned AS t
        CROSS JOIN audit_event
        `,
        [
          id,
          nextStatus,
          randomUUID(),
          "system",
          "database.provision",
          `database_instance:${id}`,
          auditOutcome,
          JSON.stringify({
            server_key: claimed.server_key,
            database_name: claimed.database_name,
            ...(provisioningErrorCode
              ? { error_code: provisioningErrorCode }
              : {}),
          }),
        ],
      );

      finalized =
        result.rows.length === 1 &&
        result.rows[0]?.lifecycle_status === nextStatus;
    } catch (error) {
      request.log.error(
        { err: error },
        "Failed to atomically finalize provisioning and audit",
      );
    }

    if (!finalized) {
      return reply.code(500).send({
        error: "Provisioning could not be finalized in the registry.",
        recovery_required: true,
        lifecycleStatus: "provisioning",
        message:
          "Do not retry provisioning automatically. Inspect the target database and registry state, then reconcile them explicitly.",
      });
    }

    if (provisioningErrorCode === "DATABASE_ALREADY_EXISTS") {
      return reply.code(409).send({
        error: "The target database already exists and was not adopted.",
        lifecycleStatus: "failed",
      });
    }

    if (!succeeded) {
      return reply.code(502).send({
        error: "PostgreSQL could not create the target database.",
        lifecycleStatus: "failed",
      });
    }

    return reply.code(201).send({
      data: {
        id: claimed.id,
        project_id: claimed.project_id,
        environment: claimed.environment,
        database_name: claimed.database_name,
        server_key: claimed.server_key,
        status: "ready",
      },
    });
  });

  app.post<{
    Params: { id: string };
  }>("/api/database-instances/:id/verify", async (request, reply) => {
    const { id } = request.params;

    if (!isUuid(id)) {
      return reply.code(400).send({
        error: "id must be a valid UUID.",
      });
    }

    let instance: DatabaseInstance | null;

    try {
      instance = await instances.getById(id);
    } catch (error) {
      request.log.error({ err: error }, "Failed to retrieve database instance");
      return reply.code(500).send({
        error: "Unable to retrieve database instance.",
      });
    }

    if (!instance) {
      return reply.code(404).send({
        error: "Database instance not found.",
      });
    }

    let verification: DatabaseVerificationResult;

    try {
      const server = resolveTrustedServer(instance.server_key);
      verification = await verifyConnection(server, instance.database_name);
    } catch (error) {
      const unknownServer =
        error instanceof Error &&
        error.message === "Unknown trusted database server.";

      verification = {
        ok: false,
        serverKey: instance.server_key,
        databaseName: instance.database_name,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        code: unknownServer ? "UNKNOWN_SERVER" : "CONFIGURATION_ERROR",
        message: unknownServer
          ? "The registered database references an unknown trusted server."
          : "Trusted database configuration is unavailable or invalid.",
      };
    }

    let lifecycleStatus: string;

    try {
      const result = await executor.query<{ lifecycle_status: string }>(
        `
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
            $3,
            $4,
            $5,
            $6,
            $7,
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
        `,
        [
          instance.id,
          verification.ok,
          randomUUID(),
          "system",
          "database.connection.verify",
          `database_instance:${instance.id}`,
          verification.ok ? "succeeded" : "failed",
          JSON.stringify({
            verification_code: verification.code,
            server_key: instance.server_key,
            database_name: instance.database_name,
            duration_ms: verification.durationMs,
          }),
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({
          error: "Database instance no longer exists.",
        });
      }

      lifecycleStatus = result.rows[0].lifecycle_status;
    } catch (error) {
      request.log.error(
        { err: error },
        "Failed to atomically record verification and transition lifecycle status",
      );
      return reply.code(500).send({
        error: "Unable to record database verification and update lifecycle status.",
      });
    }

    return reply
      .code(verification.ok ? 200 : 502)
      .send({
        data: {
          ...verification,
          lifecycleStatus,
        },
      });
  });

  return app;
}
