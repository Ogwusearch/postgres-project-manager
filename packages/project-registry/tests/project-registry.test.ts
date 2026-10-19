import assert from "node:assert/strict";
import test from "node:test";

import {
  createDatabaseInstanceInputSchema,
  createProjectInputSchema,
  databaseInstanceSchema,
  parseCreateDatabaseInstanceInput,
  parseCreateProjectInput,
  parseDatabaseInstance,
  parseProject,
  projectSchema,
} from "../src/index.js";

const projectId = "7f8e2f2e-5a6c-4c23-9e8a-123456789abc";
const instanceId = "8f8e2f2e-5a6c-4c23-9e8a-123456789abc";

const project = {
  id: projectId,
  project_key: "solar-audit",
  name: "Solar Audit",
  status: "active",
  created_at: "2026-01-15T10:30:00.000Z",
};

const instance = {
  id: instanceId,
  project_id: projectId,
  environment: "development",
  database_name: "solar_audit_dev",
  server_key: "local-postgres",
  status: "planned",
  created_at: "2026-01-15T10:30:00.000Z",
};

test("accepts a valid project creation input", () => {
  assert.deepEqual(
    parseCreateProjectInput({
      project_key: " solar-audit ",
      name: " Solar Audit ",
    }),
    {
      project_key: "solar-audit",
      name: "Solar Audit",
      status: "active",
    },
  );
});

test("rejects invalid project keys", () => {
  for (const project_key of [
    "",
    "bad key",
    "-starts-with-dash",
    "a".repeat(101),
  ]) {
    assert.equal(
      createProjectInputSchema.safeParse({
        project_key,
        name: "Example",
      }).success,
      false,
    );
  }
});

test("defaults project status to active and accepts supported statuses", () => {
  assert.equal(
    parseCreateProjectInput({
      project_key: "example",
      name: "Example",
    }).status,
    "active",
  );

  assert.equal(
    parseCreateProjectInput({
      project_key: "example",
      name: "Example",
      status: "archived",
    }).status,
    "archived",
  );

  assert.equal(
    createProjectInputSchema.safeParse({
      project_key: "example",
      name: "Example",
      unexpected: true,
    }).success,
    false,
  );
});

test("accepts persisted projects with ISO timestamps and Date timestamps", () => {
  assert.deepEqual(parseProject(project), project);

  const dateProject = {
    ...project,
    created_at: new Date(project.created_at),
  };

  assert.deepEqual(parseProject(dateProject), dateProject);
});

test("rejects invalid project records", () => {
  assert.equal(
    projectSchema.safeParse({
      ...project,
      id: "not-a-uuid",
    }).success,
    false,
  );

  assert.equal(
    projectSchema.safeParse({
      ...project,
      status: "deleted",
    }).success,
    false,
  );
});

test("accepts valid database instance creation input", () => {
  assert.deepEqual(
    parseCreateDatabaseInstanceInput({
      environment: "development",
      database_name: "solar_audit_dev",
    }),
    {
      environment: "development",
      database_name: "solar_audit_dev",
      server_key: "local-postgres",
      status: "planned",
    },
  );
});

test("rejects client-controlled instance fields", () => {
  assert.equal(
    createDatabaseInstanceInputSchema.safeParse({
      environment: "development",
      database_name: "solar_audit_dev",
      server_key: "local-postgres",
      status: "ready",
    }).success,
    false,
  );

  assert.equal(
    createDatabaseInstanceInputSchema.safeParse({
      environment: "development",
      database_name: "solar_audit_dev",
      server_key: "local-postgres",
      project_id: projectId,
    }).success,
    false,
  );
});

test("rejects invalid environment and database identifiers", () => {
  assert.equal(
    createDatabaseInstanceInputSchema.safeParse({
      environment: "production-ish",
      database_name: "solar_audit_dev",
      server_key: "local-postgres",
    }).success,
    false,
  );

  assert.equal(
    createDatabaseInstanceInputSchema.safeParse({
      environment: "development",
      database_name: "bad-name",
      server_key: "local-postgres",
    }).success,
    false,
  );

  assert.equal(
    createDatabaseInstanceInputSchema.safeParse({
      environment: "development",
      database_name: "solar_audit_dev",
      server_key: "../unexpected",
    }).success,
    false,
  );
});

test("accepts persisted instances with ISO timestamps and Date timestamps", () => {
  assert.deepEqual(parseDatabaseInstance(instance), instance);

  const dateInstance = {
    ...instance,
    created_at: new Date(instance.created_at),
  };

  assert.deepEqual(parseDatabaseInstance(dateInstance), dateInstance);
});

test("rejects a database instance with an invalid project reference", () => {
  assert.equal(
    databaseInstanceSchema.safeParse({
      ...instance,
      project_id: "invalid",
    }).success,
    false,
  );
});

test("accepts archived projects and rejects unknown project statuses", () => {
  assert.equal(
    projectSchema.safeParse({
      ...project,
      status: "archived",
    }).success,
    true,
  );

  assert.equal(
    projectSchema.safeParse({
      ...project,
      status: "deleted",
    }).success,
    false,
  );
});

test("rejects unknown database instance statuses", () => {
  assert.equal(
    databaseInstanceSchema.safeParse({
      ...instance,
      status: "deleted",
    }).success,
    false,
  );
});
