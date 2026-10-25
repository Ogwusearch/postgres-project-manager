import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import {
  authorize,
  type AccessPermission,
  type AccessResource,
} from "@postgres-project-manager/access-control";
import {
  createAuthRepository,
  type ActiveSession,
} from "./repositories/auth.repository.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  clearSessionCookies,
  createToken,
  csrfCookie,
  csrfTokensMatch,
  hashToken,
  normalizeEmail,
  readCookie,
  sessionCookie,
  verifyPassword,
} from "./services/authentication.js";
import {
  resolveTenantAuthorizationContext,
  type TenantAuthorizationContext,
} from "./services/authorization-context.js";
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
import { createLoginThrottle } from "./services/login-throttle.js";
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
  loginThrottle?: ReturnType<typeof createLoginThrottle>;
}

export function createApp(executor: SqlExecutor, options: CreateAppOptions = {}) {
  const app = Fastify({
    logger: false,
    trustProxy: false,
  });
  const projects = createProjectRepository(executor);
  const instances = createDatabaseInstanceRepository(executor);
  const auth = createAuthRepository(executor);
  const loginThrottle = options.loginThrottle ?? createLoginThrottle();

  const requestSessions = new WeakMap<FastifyRequest, ActiveSession>();
  const requestContexts =
    new WeakMap<FastifyRequest, TenantAuthorizationContext>();

  function permits(
    context: TenantAuthorizationContext,
    action: AccessPermission,
    resource: AccessResource,
  ): boolean {
    return authorize({
      subject: context.subject,
      action,
      resource,
    }).allowed;
  }

  const verifyConnection =
    options.verifyConnection ?? verifyDatabaseConnection;
  const resolveTrustedServer =
    options.getTrustedServer ?? getTrustedDatabaseServer;
  const provision = options.provisionDatabase ?? provisionDatabase;
  const resolveProvisioningServer =
    options.getProvisioningServer ?? getTrustedProvisioningServer;

  // Fail-closed authentication, CSRF, tenant resolution, and route authorization.
  app.addHook("preHandler", async (request, reply) => {
    const pathname = (request.url.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
    if (!pathname.startsWith("/api/") || pathname === "/api/auth/login") {
      return;
    }

    try {
      const rawSessionToken = readCookie(
        request.headers.cookie,
        SESSION_COOKIE,
      );

      // Logout must remain possible with an expired or missing session cookie.
      if (!rawSessionToken && pathname === "/api/auth/logout") {
        return;
      }

      if (!rawSessionToken) {
        return reply.code(401).send({ error: "Authentication required." });
      }

      const session = await auth.findActiveSession(hashToken(rawSessionToken));

      if (!session) {
        if (pathname === "/api/auth/logout") {
          return;
        }

        return reply.code(401).send({
          error: "Session is invalid, expired, revoked, or disabled.",
        });
      }

      requestSessions.set(request, session);

      const isMutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (isMutating) {
        const csrfCookie = readCookie(request.headers.cookie, CSRF_COOKIE);
        const header = request.headers["x-csrf-token"];
        const csrfHeader = typeof header === "string" ? header : undefined;

        if (
          !csrfTokensMatch(
            csrfCookie,
            csrfHeader,
            session.csrf_token_hash,
          )
        ) {
          return reply.code(403).send({ error: "CSRF validation failed." });
        }
      }

      if (pathname === "/api/auth/me" || pathname === "/api/auth/logout") {
        return;
      }

      const tenantHeader = request.headers["x-tenant-id"];
      const requestedTenantId =
        typeof tenantHeader === "string" ? tenantHeader : undefined;

      const resolution = await resolveTenantAuthorizationContext(
        auth,
        session,
        requestedTenantId,
      );

      if (!resolution.ok) {
        return reply.code(resolution.status).send({
          error: resolution.error,
        });
      }

      const context = resolution.context;
      requestContexts.set(request, context);

      if (pathname === "/api/projects") {
        if (request.method === "POST") {
          const allowed = permits(context, "project:create", {
            type: "tenant",
            id: context.tenant.id,
            tenantId: context.tenant.id,
          });

          if (!allowed) {
            return reply.code(403).send({ error: "Project creation is not permitted." });
          }
        } else if (
          request.method === "GET" &&
          !context.subject.permissions.includes("project:read")
        ) {
          return reply.code(403).send({ error: "Project access is not permitted." });
        }

        return;
      }

      if (/^\/api\/projects\/[^/]+\/database-instances$/.test(pathname)) {
        const params = request.params as { projectId?: string };
        const projectId = params.projectId;

        if (!projectId || !isUuid(projectId)) {
          return;
        }

        const project = await projects.getById(projectId, context.tenant.id);

        if (!project) {
          return reply.code(404).send({ error: "Project not found." });
        }

        if (request.method === "POST") {
          const allowed = permits(context, "database-instance:create", {
            type: "project",
            id: project.id,
            tenantId: context.tenant.id,
          });

          if (!allowed) {
            return reply.code(403).send({
              error: "Database instance creation is not permitted for this project.",
            });
          }
        } else if (request.method === "GET") {
          const allowed = permits(context, "project:read", {
            type: "project",
            id: project.id,
            tenantId: context.tenant.id,
          });

          if (
            !allowed ||
            !context.subject.permissions.includes("database-instance:read")
          ) {
            return reply.code(403).send({
              error: "Database instance access is not permitted for this project.",
            });
          }
        }

        return;
      }

      if (pathname === "/api/database-instances" && request.method === "GET") {
        if (!context.subject.permissions.includes("database-instance:read")) {
          return reply.code(403).send({
            error: "Database instance access is not permitted.",
          });
        }

        const query = request.query as { project_id?: string };
        if (query.project_id) {
          if (!isUuid(query.project_id)) {
            return reply.code(400).send({
              error: "project_id must be a valid UUID.",
            });
          }

          const project = await projects.getById(
            query.project_id,
            context.tenant.id,
          );

          if (!project) {
            return reply.code(404).send({ error: "Project not found." });
          }

          if (
            !permits(context, "project:read", {
              type: "project",
              id: project.id,
              tenantId: context.tenant.id,
            })
          ) {
            return reply.code(403).send({
              error: "Database instance access is not permitted for this project.",
            });
          }
        }

        return;
      }

      const instanceRoute = pathname.match(
        /^\/api\/database-instances\/([^/]+)\/(provision|verify)$/,
      );

      if (instanceRoute && request.method === "POST") {
        const params = request.params as { id?: string };
        const id = params.id;

        if (!id || !isUuid(id)) {
          return;
        }

        const instance = await instances.getById(id, context.tenant.id);

        if (!instance) {
          return reply.code(404).send({
            error: "Database instance not found.",
          });
        }

        const allowed = permits(context, "database-instance:update", {
          type: "database-instance",
          id: instance.id,
          tenantId: context.tenant.id,
          projectId: instance.project_id,
        });

        if (!allowed) {
          return reply.code(403).send({
            error: "Database instance operation is not permitted.",
          });
        }

        return;
      }

      // Unknown /api routes fail closed rather than inheriting access.
      return reply.code(404).send({ error: "Not found." });
    } catch (error) {
      request.log.error({ err: error }, "Authentication or authorization failed");
      return reply.code(500).send({
        error: "Unable to validate authentication and authorization.",
      });
    }
  });

  // Liveness: confirms the application process can respond.
  // Deliberately does not depend on database availability.
  app.get("/health/live", async () => {
    return { status: "ok" };
  });

  // Readiness: confirms the control database is reachable.
  // Do not expose database hosts, usernames, or driver error details.
  app.get("/health/ready", async (_request, reply) => {
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

  // Backward compatibility for existing health-check clients.
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

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body;

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return reply.code(400).send({ error: "A JSON object is required." });
    }

    const input = body as Record<string, unknown>;
    const email = typeof input.email === "string"
      ? normalizeEmail(input.email)
      : "";
    const password = typeof input.password === "string"
      ? input.password
      : "";

    if (
      email.length < 3 ||
      email.length > 254 ||
      password.length === 0 ||
      password.length > 1024
    ) {
      return reply.code(400).send({ error: "Email and password are required." });
    }

    const throttleDecision = loginThrottle.check(email, request.ip);

    if (throttleDecision.limited) {
      return reply
        .header("Retry-After", String(throttleDecision.retryAfterSeconds))
        .code(429)
        .send({ error: "Too many login attempts. Please try again later." });
    }

    try {
      const user = await auth.findUserByEmail(email);
      const passwordValid = user
        ? await verifyPassword(password, user.password_hash)
        : false;

      if (!user || user.status !== "active" || !passwordValid) {
        loginThrottle.failed(email, request.ip);

        return reply.code(401).send({
          error: "Invalid email or password.",
        });
      }

      loginThrottle.succeeded(email);

      const sessionToken = createToken();
      const csrfToken = createToken();
      const expiresAt = new Date(
        Date.now() + SESSION_LIFETIME_SECONDS * 1000,
      );

      const userAgent = request.headers["user-agent"];

      await auth.createSession({
        id: randomUUID(),
        user_id: user.id,
        token_hash: hashToken(sessionToken),
        csrf_token_hash: hashToken(csrfToken),
        expires_at: expiresAt,
        user_agent: typeof userAgent === "string"
          ? userAgent.slice(0, 512)
          : null,
        client_ip: request.ip || null,
      });

      return reply
        .header("set-cookie", [
          sessionCookie(sessionToken),
          csrfCookie(csrfToken),
        ])
        .send({
          data: {
            id: user.id,
            email: user.email,
            is_super_admin: user.is_super_admin,
          },
        });
    } catch (error) {
      request.log.error({ err: error }, "Login failed");
      return reply.code(500).send({ error: "Unable to sign in." });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const session = requestSessions.get(request);

    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }

    try {
      const memberships = await auth.listMemberships(session.user_id);

      return {
        data: {
          id: session.user_id,
          email: session.email,
          is_super_admin: session.is_super_admin,
          memberships,
        },
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to retrieve session profile");
      return reply.code(500).send({ error: "Unable to retrieve profile." });
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const rawSessionToken = readCookie(
      request.headers.cookie,
      SESSION_COOKIE,
    );

    try {
      if (rawSessionToken) {
        await auth.revokeSession(hashToken(rawSessionToken));
      }

      return reply
        .header("set-cookie", clearSessionCookies())
        .code(204)
        .send();
    } catch (error) {
      request.log.error({ err: error }, "Logout failed");
      return reply.code(500).send({ error: "Unable to sign out." });
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
      const project = await projects.create(buildCreateProjectInput(input, requestContexts.get(request)!.tenant.id));
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
      const data = await projects.list(
        requestContexts.get(request)!.tenant.id,
        requestContexts.get(request)!.subject.projectIds as string[],
        limit,
        offset,
      );
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
      const project = await projects.getById(projectId, requestContexts.get(request)!.tenant.id);

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
      const project = await projects.getById(projectId, requestContexts.get(request)!.tenant.id);

      if (!project) {
        return reply.code(404).send({ error: "Project not found." });
      }

      return { data: await instances.list(
        requestContexts.get(request)!.tenant.id,
        requestContexts.get(request)!.subject.projectIds as string[],
        projectId,
      ) };
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
        const project = await projects.getById(projectId, requestContexts.get(request)!.tenant.id);

        if (!project) {
          return reply.code(404).send({ error: "Project not found." });
        }
      }

      return { data: await instances.list(
        requestContexts.get(request)!.tenant.id,
        requestContexts.get(request)!.subject.projectIds as string[],
        projectId,
      ) };
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
      instance = await instances.getById(id, requestContexts.get(request)!.tenant.id);
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
        requestContexts.get(request)!.tenant.id,
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
          SELECT di.id, di.status
          FROM public.database_instances AS di
          JOIN public.projects AS p ON p.id = di.project_id
          WHERE di.id = $1
            AND p.tenant_id = $9
          FOR UPDATE OF di
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
          requestContexts.get(request)!.userId,
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
          requestContexts.get(request)!.tenant.id,
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
      instance = await instances.getById(id, requestContexts.get(request)!.tenant.id);
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
          requestContexts.get(request)!.userId,
          "database.connection.verify",
          `database_instance:${instance.id}`,
          verification.ok ? "succeeded" : "failed",
          JSON.stringify({
            verification_code: verification.code,
            server_key: instance.server_key,
            database_name: instance.database_name,
            duration_ms: verification.durationMs,
          }),
          requestContexts.get(request)!.tenant.id,
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
