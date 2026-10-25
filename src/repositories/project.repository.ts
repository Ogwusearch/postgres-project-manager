import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";

export type ProjectStatus = "active" | "inactive" | "archived";

export interface Project {
  id: string;
  tenant_id: string;
  project_key: string;
  name: string;
  status: ProjectStatus;
  created_at: Date;
}

export interface CreateProjectInput {
  id: string;
  tenant_id: string;
  project_key: string;
  name: string;
  status: ProjectStatus;
}

export function createProjectRepository(executor: SqlExecutor) {
  return {
    async create(input: CreateProjectInput): Promise<Project> {
      const result = await executor.query<Project>(
        `INSERT INTO public.projects
          (id, tenant_id, project_key, name, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, project_key, name, status, created_at`,
        [
          input.id,
          input.tenant_id,
          input.project_key,
          input.name,
          input.status,
        ],
      );

      return result.rows[0]!;
    },

    async getById(
      id: string,
      tenantId: string,
    ): Promise<Project | null> {
      const result = await executor.query<Project>(
        `SELECT id, tenant_id, project_key, name, status, created_at
         FROM public.projects
         WHERE id = $1
           AND tenant_id = $2
         LIMIT 1`,
        [id, tenantId],
      );

      return result.rows[0] ?? null;
    },

    async list(
      tenantId: string,
      projectIds: string[],
      limit: number,
      offset: number,
    ): Promise<Project[]> {
      const result = await executor.query<Project>(
        `SELECT id, tenant_id, project_key, name, status, created_at
         FROM public.projects
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])
         ORDER BY created_at DESC, id
         LIMIT $3 OFFSET $4`,
        [tenantId, projectIds, limit, offset],
      );

      return result.rows;
    },
  };
}
