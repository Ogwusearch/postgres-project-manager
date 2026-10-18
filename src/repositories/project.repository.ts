import type { Pool } from "pg";

export type ProjectStatus = "active" | "inactive" | "archived";

export interface Project {
  id: string;
  project_key: string;
  name: string;
  status: ProjectStatus;
  created_at: Date;
}

export interface CreateProjectInput {
  id: string;
  project_key: string;
  name: string;
  status: ProjectStatus;
}

export function createProjectRepository(pool: Pool) {
  return {
    async create(input: CreateProjectInput): Promise<Project> {
      const result = await pool.query<Project>(
        `INSERT INTO public.projects (id, project_key, name, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, project_key, name, status, created_at`,
        [input.id, input.project_key, input.name, input.status],
      );

      return result.rows[0]!;
    },

    async getById(id: string): Promise<Project | null> {
      const result = await pool.query<Project>(
        `SELECT id, project_key, name, status, created_at
         FROM public.projects
         WHERE id = $1`,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async list(limit: number, offset: number): Promise<Project[]> {
      const result = await pool.query<Project>(
        `SELECT id, project_key, name, status, created_at
         FROM public.projects
         ORDER BY created_at DESC, id
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      return result.rows;
    },
  };
}
