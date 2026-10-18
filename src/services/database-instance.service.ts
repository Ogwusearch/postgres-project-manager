import { randomUUID } from "node:crypto";
import type {
  CreateDatabaseInstanceInput,
  DatabaseEnvironment,
  DatabaseInstanceStatus,
} from "../repositories/database-instance.repository.js";

const environments = [
  "development",
  "staging",
  "production",
] as const;

const statuses = [
  "planned",
  "provisioning",
  "ready",
  "failed",
  "retired",
] as const;

export interface RegisterDatabaseInstanceInput {
  environment: DatabaseEnvironment;
  database_name: string;
  server_key: string;
  status: DatabaseInstanceStatus;
}

export function validateDatabaseInstanceInput(
  input: unknown,
): RegisterDatabaseInstanceInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  const body = input as Record<string, unknown>;

  const environment = body.environment;
  const database_name =
    typeof body.database_name === "string"
      ? body.database_name.trim()
      : "";
  const server_key =
    body.server_key === undefined
      ? "local-postgres"
      : typeof body.server_key === "string"
        ? body.server_key.trim()
        : "";
  // Instance registration always starts in planned state.
  // Lifecycle transitions must be controlled by the platform.
  if (body.status !== undefined && body.status !== "planned") {
    throw new Error(
      "status is managed by the platform; new instances must start as planned.",
    );
  }

  const status = "planned" as const;

  if (
    typeof environment !== "string" ||
    !environments.includes(environment as DatabaseEnvironment)
  ) {
    throw new Error(
      "environment must be development, staging, or production.",
    );
  }

  // Conservative PostgreSQL identifier validation; maximum 63 characters.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database_name)) {
    throw new Error(
      "database_name must be a valid identifier of 1-63 letters, numbers, or underscores, starting with a letter or underscore.",
    );
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(server_key)) {
    throw new Error(
      "server_key must be 1-100 characters and start with a letter or number.",
    );
  }

  if (
    typeof status !== "string" ||
    !statuses.includes(status as DatabaseInstanceStatus)
  ) {
    throw new Error(
      "status must be planned, provisioning, ready, failed, or retired.",
    );
  }

  return {
    environment: environment as DatabaseEnvironment,
    database_name,
    server_key,
    status: status as DatabaseInstanceStatus,
  };
}

export function buildCreateDatabaseInstanceInput(
  projectId: string,
  input: RegisterDatabaseInstanceInput,
): CreateDatabaseInstanceInput {
  return {
    id: randomUUID(),
    project_id: projectId,
    environment: input.environment,
    database_name: input.database_name,
    server_key: input.server_key,
    status: input.status,
  };
}
