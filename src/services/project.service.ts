import { randomUUID } from "node:crypto";
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@postgres-project-manager/project-registry";
import type { CreateProjectInput } from "../repositories/project.repository.js";

export interface RegisterProjectInput {
  project_key: string;
  name: string;
  status?: ProjectStatus;
}

export function validateProjectInput(
  input: unknown,
): RegisterProjectInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  const body = input as Record<string, unknown>;
  const project_key =
    typeof body.project_key === "string" ? body.project_key.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const status = body.status === undefined ? "active" : body.status;

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(project_key)) {
    throw new Error(
      "project_key must be 1-100 characters and contain only letters, numbers, dots, underscores, or hyphens; it must start with a letter or number.",
    );
  }

  if (name.length < 1 || name.length > 200) {
    throw new Error("name must be between 1 and 200 characters.");
  }

  if (
    typeof status !== "string" ||
    !PROJECT_STATUSES.includes(status as ProjectStatus)
  ) {
    throw new Error("status must be active, inactive, or archived.");
  }

  return {
    project_key,
    name,
    status: status as ProjectStatus,
  };
}

export function buildCreateProjectInput(
  input: RegisterProjectInput,
  tenantId: string,
): CreateProjectInput {
  return {
    id: randomUUID(),
    tenant_id: tenantId,
    project_key: input.project_key,
    name: input.name,
    status: input.status ?? "active",
  };
}
