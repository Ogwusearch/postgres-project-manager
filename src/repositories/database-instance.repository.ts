import type { Pool } from "pg";

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

export function createDatabaseInstanceRepository(pool: Pool) {
  return {
    async create(
      input: CreateDatabaseInstanceInput,
    ): Promise<DatabaseInstance> {
      const result = await pool.query<DatabaseInstance>(
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

    async getById(id: string): Promise<DatabaseInstance | null> {
      const result = await pool.query<DatabaseInstance>(
        `SELECT ${columns}
         FROM public.database_instances
         WHERE id = $1
         LIMIT 1`,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async transitionStatus(
      id: string,
      expectedStatuses: DatabaseInstanceStatus[],
      nextStatus: DatabaseInstanceStatus,
    ): Promise<DatabaseInstance | null> {
      if (expectedStatuses.length === 0) {
        return null;
      }

      const result = await pool.query<DatabaseInstance>(
        `UPDATE public.database_instances
         SET status = $3
         WHERE id = $1
           AND status = ANY($2::text[])
         RETURNING ${columns}`,
        [id, expectedStatuses, nextStatus],
      );

      return result.rows[0] ?? null;
    },

    async list(projectId?: string): Promise<DatabaseInstance[]> {
      if (projectId) {
        const result = await pool.query<DatabaseInstance>(
          `SELECT ${columns}
           FROM public.database_instances
           WHERE project_id = $1
           ORDER BY created_at DESC, id`,
          [projectId],
        );

        return result.rows;
      }

      const result = await pool.query<DatabaseInstance>(
        `SELECT ${columns}
         FROM public.database_instances
         ORDER BY created_at DESC, id`,
      );

      return result.rows;
    },
  };
}