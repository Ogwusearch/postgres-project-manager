import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";

export type DatabaseEnvironment =
  | "development"
  | "staging"
  | "production";

export type DatabaseInstanceStatus =
  | "planned"
  | "provisioning"
  | "ready"
  | "failed"
  | "retired";

export interface DatabaseInstance {
  id: string;
  project_id: string;
  environment: DatabaseEnvironment;
  database_name: string;
  server_key: string;
  status: DatabaseInstanceStatus;
  created_at: Date;
}

export interface CreateDatabaseInstanceInput {
  id: string;
  project_id: string;
  environment: DatabaseEnvironment;
  database_name: string;
  server_key: string;
  status: DatabaseInstanceStatus;
}

const columns = `
  id, project_id, environment, database_name,
  server_key, status, created_at
`;

const joinedColumns = `
  di.id, di.project_id, di.environment, di.database_name,
  di.server_key, di.status, di.created_at
`;

export function createDatabaseInstanceRepository(executor: SqlExecutor) {
  return {
    async create(
      input: CreateDatabaseInstanceInput,
    ): Promise<DatabaseInstance> {
      const result = await executor.query<DatabaseInstance>(
        `INSERT INTO public.database_instances
          (id, project_id, environment, database_name, server_key, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${columns}`,
        [
          input.id,
          input.project_id,
          input.environment,
          input.database_name,
          input.server_key,
          input.status,
        ],
      );

      return result.rows[0]!;
    },

    async getById(
      id: string,
      tenantId: string,
    ): Promise<DatabaseInstance | null> {
      const result = await executor.query<DatabaseInstance>(
        `SELECT ${joinedColumns}
         FROM public.database_instances AS di
         JOIN public.projects AS p ON p.id = di.project_id
         WHERE di.id = $1
           AND p.tenant_id = $2
         LIMIT 1`,
        [id, tenantId],
      );

      return result.rows[0] ?? null;
    },

    async transitionStatus(
      id: string,
      tenantId: string,
      expectedStatuses: DatabaseInstanceStatus[],
      nextStatus: DatabaseInstanceStatus,
    ): Promise<DatabaseInstance | null> {
      if (expectedStatuses.length === 0) {
        return null;
      }

      const result = await executor.query<DatabaseInstance>(
        `UPDATE public.database_instances AS di
         SET status = $4
         WHERE di.id = $1
           AND di.status = ANY($3::text[])
           AND EXISTS (
             SELECT 1
             FROM public.projects AS p
             WHERE p.id = di.project_id
               AND p.tenant_id = $2
           )
         RETURNING ${joinedColumns}`,
        [id, tenantId, expectedStatuses, nextStatus],
      );

      return result.rows[0] ?? null;
    },

    async list(
      tenantId: string,
      projectIds: string[],
      projectId?: string,
    ): Promise<DatabaseInstance[]> {
      const result = await executor.query<DatabaseInstance>(
        `SELECT ${joinedColumns}
         FROM public.database_instances AS di
         JOIN public.projects AS p ON p.id = di.project_id
         WHERE p.tenant_id = $1
           AND di.project_id = ANY($2::uuid[])
           AND ($3::uuid IS NULL OR di.project_id = $3::uuid)
         ORDER BY di.created_at DESC, di.id`,
        [tenantId, projectIds, projectId ?? null],
      );

      return result.rows;
    },
  };
}
