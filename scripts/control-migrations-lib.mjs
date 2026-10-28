import {
  sha256,
  parseMigrationFilename,
  prepareMigrationSql,
  classifyDatabase,
  assertUniqueVersions,
  assertContiguousMigrationVersions,
  assertValidMigrationHistory,
  assertValidHistoryTableSchema,
  assertFreshDatabaseHasNoPublicObjects,
  assertExpectedIndexDefinitions,
  assertExpectedConstraintDefinitions,
} from "@postgres-project-manager/migration-runner";

export {
  sha256,
  parseMigrationFilename,
  prepareMigrationSql,
  classifyDatabase,
  assertUniqueVersions,
  assertContiguousMigrationVersions,
  assertValidMigrationHistory,
  assertValidHistoryTableSchema,
  assertFreshDatabaseHasNoPublicObjects,
  assertExpectedIndexDefinitions,
  assertExpectedConstraintDefinitions,
};

/**
 * Protect the platform's primary control database from the migration runner.
 */
export function assertSafeControlMigrationDatabase(database) {
  if (typeof database !== "string" || database.trim() !== database || !database) {
    throw new Error("Invalid control migration database name");
  }

  if (database === "platform_control_db") {
    throw new Error(
      "Refusing to run control migrations against the protected database",
    );
  }
}

/**
 * Validate normal and explicitly confirmed administrative migration targets.
 */
export function assertControlMigrationTarget({
  database,
  allowProtected = false,
  confirmation,
  migrationUser,
  runtimeUser,
}) {
  if (allowProtected) {
    if (
      database !== "platform_control_db" ||
      confirmation !== "platform_control_db"
    ) {
      throw new Error(
        "Protected control database requires exact confirmation: platform_control_db",
      );
    }

    if (
      typeof migrationUser !== "string" ||
      !migrationUser ||
      typeof runtimeUser !== "string" ||
      !runtimeUser ||
      migrationUser === runtimeUser
    ) {
      throw new Error(
        "Protected control database migrations require a separate administrative role",
      );
    }

    return;
  }

  if (confirmation !== undefined) {
    throw new Error(
      "Database confirmation is only accepted with --allow-protected-control-db",
    );
  }

  assertSafeControlMigrationDatabase(database);
}
