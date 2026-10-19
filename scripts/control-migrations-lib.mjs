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
