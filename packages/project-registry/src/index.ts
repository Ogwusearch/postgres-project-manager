import { z } from "zod";

/**
 * Domain contracts for registered projects and database instances.
 *
 * This package is deliberately independent of HTTP, PostgreSQL connections,
 * repositories, migrations, and infrastructure provisioning.
 */

export const PROJECT_STATUSES = [
  "active",
  "inactive",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DATABASE_ENVIRONMENTS = [
  "development",
  "staging",
  "production",
] as const;

export type DatabaseEnvironment =
  (typeof DATABASE_ENVIRONMENTS)[number];

export const DATABASE_INSTANCE_STATUSES = [
  "planned",
  "provisioning",
  "ready",
  "failed",
  "retired",
] as const;

export type DatabaseInstanceStatus =
  (typeof DATABASE_INSTANCE_STATUSES)[number];

const uuidSchema = z.string().uuid();

export const projectKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    "Project keys must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.",
  );

export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200);

export const databaseNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/,
    "Database names must be 1-63 characters, use only letters, numbers, or underscores, and start with a letter or underscore.",
  );

export const serverKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    "Server keys must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.",
  );

export const projectStatusSchema = z.enum(PROJECT_STATUSES);

export const databaseEnvironmentSchema = z.enum(
  DATABASE_ENVIRONMENTS,
);

export const databaseInstanceStatusSchema = z.enum(
  DATABASE_INSTANCE_STATUSES,
);

export const createProjectInputSchema = z
  .object({
    project_key: projectKeySchema,
    name: projectNameSchema,
    status: projectStatusSchema.default("active"),
  })
  .strict();

export const projectSchema = z
  .object({
    id: uuidSchema,
    project_key: projectKeySchema,
    name: projectNameSchema,
    status: projectStatusSchema,
    created_at: z.union([
      z.date(),
      z.iso.datetime({ offset: true }),
    ]),
  })
  .strict();

export const createDatabaseInstanceInputSchema = z
  .object({
    environment: databaseEnvironmentSchema,
    database_name: databaseNameSchema,
    server_key: serverKeySchema.default("local-postgres"),
    status: z.literal("planned").default("planned"),
  })
  .strict();

export const databaseInstanceSchema = z
  .object({
    id: uuidSchema,
    project_id: uuidSchema,
    environment: databaseEnvironmentSchema,
    database_name: databaseNameSchema,
    server_key: serverKeySchema,
    status: databaseInstanceStatusSchema,
    created_at: z.union([
      z.date(),
      z.iso.datetime({ offset: true }),
    ]),
  })
  .strict();

/**
 * Project status defaults to active, matching the existing service.
 * Unknown fields are rejected by the strict creation schema.
 */
export type CreateProjectInput = z.input<
  typeof createProjectInputSchema
>;

export type Project = z.infer<typeof projectSchema>;

/**
 * The initial status, when supplied, can only be planned. IDs and the
 * project reference are supplied by the owning application.
 */
export type CreateDatabaseInstanceInput = z.input<
  typeof createDatabaseInstanceInputSchema
>;

export type DatabaseInstance = z.infer<
  typeof databaseInstanceSchema
>;

export interface ProjectRepository {
  create(input: {
    id: string;
    project_key: string;
    name: string;
    status: ProjectStatus;
  }): Promise<Project>;

  getById(id: string): Promise<Project | null>;

  list(limit: number, offset: number): Promise<Project[]>;
}

export interface DatabaseInstanceRepository {
  create(input: {
    id: string;
    project_id: string;
    environment: DatabaseEnvironment;
    database_name: string;
    server_key: string;
    status: DatabaseInstanceStatus;
  }): Promise<DatabaseInstance>;

  getById(id: string): Promise<DatabaseInstance | null>;

  list(projectId?: string): Promise<DatabaseInstance[]>;
}

export interface ProjectRegistry {
  projects: ProjectRepository;
  databaseInstances: DatabaseInstanceRepository;
}

/**
 * Parse untrusted values at application boundaries.
 * Zod errors are intentionally allowed to propagate to the caller so
 * the HTTP layer can translate them into its existing error format.
 */
export function parseCreateProjectInput(
  input: unknown,
): CreateProjectInput {
  return createProjectInputSchema.parse(input);
}

export function parseCreateDatabaseInstanceInput(
  input: unknown,
): CreateDatabaseInstanceInput {
  return createDatabaseInstanceInputSchema.parse(input);
}

export function parseProject(input: unknown): Project {
  return projectSchema.parse(input);
}

export function parseDatabaseInstance(
  input: unknown,
): DatabaseInstance {
  return databaseInstanceSchema.parse(input);
}
