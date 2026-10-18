import { createHash } from "node:crypto";

/**
 * Normalize SQL syntax without altering quoted strings or identifiers.
 * SQL keywords and unquoted identifiers are case-insensitive in PostgreSQL.
 */
function normalizeSqlDefinition(definition) {
  const source = String(definition);
  const parts = [];
  let segmentStart = 0;
  let index = 0;

  const pushUnquoted = (end) => {
    const normalized = source
      .slice(segmentStart, end)
      .replace(/\s+/g, " ")
      .replace(/\s*([(),])\s*/g, "$1")
      .replace(/\s*=\s*/g, "=")
      .replace(/\s*::\s*/g, "::")
      .toLowerCase();

    parts.push(normalized);
  };

  while (index < source.length) {
    const quote = source[index];

    if (quote === "'" || quote === '"') {
      pushUnquoted(index);

      const isEscapeString =
        quote === "'" &&
        /[eE]/.test(source[index - 1] ?? "") &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(source[index - 2]));

      let end = index + 1;

      while (end < source.length) {
        if (isEscapeString && source[end] === "\\") {
          end += 2;
          continue;
        }

        if (source[end] === quote) {
          if (source[end + 1] === quote) {
            end += 2;
            continue;
          }

          end += 1;
          break;
        }

        end += 1;
      }

      parts.push(source.slice(index, end));
      index = end;
      segmentStart = end;
      continue;
    }

    if (quote === "$") {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);

      if (match) {
        pushUnquoted(index);

        const delimiter = match[0];
        const closeAt = source.indexOf(delimiter, index + delimiter.length);
        const end = closeAt === -1
          ? source.length
          : closeAt + delimiter.length;

        parts.push(source.slice(index, end));
        index = end;
        segmentStart = end;
        continue;
      }
    }

    index += 1;
  }

  pushUnquoted(source.length);
  return parts.join("").trim();
}

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

export function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function parseMigrationFilename(filename) {
  const match = /^([0-9]{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/.exec(filename);

  if (!match) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }

  return { version: match[1], filename };
}

export function prepareMigrationSql(content, filename) {
  // Existing migrations may own their BEGIN/COMMIT wrapper.
  // Strip only an outer wrapper so history insertion shares the transaction.
  const wrapped = /^\s*BEGIN\s*;\s*([\s\S]*?)\s*COMMIT\s*;\s*$/i.exec(content);

  if (/^\s*BEGIN\s*;/i.test(content) && !wrapped) {
    throw new Error(`Invalid transaction wrapper: ${filename}`);
  }

  if (wrapped) {
    if (/\b(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(wrapped[1])) {
      throw new Error(`Nested transaction control is not allowed: ${filename}`);
    }
    return wrapped[1];
  }

  if (/\b(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(content)) {
    throw new Error(`Transaction control is not allowed: ${filename}`);
  }

  return content;
}

export function classifyDatabase({ historyExists, registryTables }) {
  if (historyExists) {
    if (registryTables.length === 0) return "history-without-registry";
    return "tracked";
  }

  if (registryTables.length === 0) return "fresh";
  return "existing-untracked";
}

export function assertUniqueVersions(migrations) {
  const seen = new Set();
  const numericVersions = new Set();

  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);

    const numericVersion = Number(migration.version);
    if (numericVersions.has(numericVersion)) {
      throw new Error(`Duplicate numeric migration version: ${migration.version}`);
    }
    numericVersions.add(numericVersion);
  }

  return [...migrations].sort((a, b) =>
    Number(a.version) - Number(b.version),
  );
}

export function assertContiguousMigrationVersions(migrations) {
  const ordered = assertUniqueVersions(migrations);

  if (ordered.length === 0 || ordered[0].version !== "001") {
    throw new Error("The first migration version must be 001");
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = Number(ordered[index - 1].version);
    const current = Number(ordered[index].version);

    if (current !== previous + 1) {
      throw new Error(
        `Migration files contain a version gap: expected ${String(previous + 1).padStart(3, "0")}`,
      );
    }
  }

  return ordered;
}

export function assertValidMigrationHistory(historyRows, migrations) {
  if (historyRows.length === 0) {
    throw new Error("Migration history is empty for a tracked database");
  }

  const ordered = [...migrations].sort((a, b) =>
    a.version.localeCompare(b.version, "en", { numeric: true }),
  );

  if (historyRows.length > ordered.length) {
    throw new Error("Migration history contains more entries than available migration files");
  }

  const appliedVersions = new Set();

  for (const row of historyRows) {
    if (appliedVersions.has(row.version)) {
      throw new Error(`Duplicate migration history version: ${row.version}`);
    }

    if (!ordered.some((migration) => migration.version === row.version)) {
      throw new Error(`Applied migration file is missing: ${row.filename}`);
    }

    appliedVersions.add(row.version);
  }

  for (let index = 0; index < historyRows.length; index += 1) {
    const expectedVersion = ordered[index].version;

    if (!appliedVersions.has(expectedVersion)) {
      throw new Error(
        `Migration history has a gap: expected version ${expectedVersion}`,
      );
    }
  }
}

export function assertValidHistoryTableSchema(columns, constraints) {
  const expectedColumns = [
    ["version", "text", "text", "NO", null, null],
    ["filename", "text", "text", "NO", null, null],
    ["checksum_sha256", "character", "bpchar", "NO", 64, null],
    ["applied_at", "timestamp with time zone", "timestamptz", "NO", null, "now()"],
  ];

  const actualColumns = columns.map((row) => [
    row.column_name,
    row.data_type,
    row.udt_name,
    row.is_nullable,
    row.character_maximum_length === null
      ? null
      : Number(row.character_maximum_length),
    row.column_default,
  ]);

  if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
    throw new Error("Migration history table columns, types, nullability or defaults differ from the expected schema");
  }

  const expectedConstraintTypes = new Map([
    ["control_schema_migrations_pkey", "p"],
    ["control_schema_migrations_filename_key", "u"],
    ["control_schema_migrations_checksum_sha256_check", "c"],
  ]);

  if (constraints.length !== expectedConstraintTypes.size) {
    throw new Error("Migration history table has an unexpected constraint set");
  }

  const seen = new Set();

  for (const constraint of constraints) {
    const expectedType = expectedConstraintTypes.get(constraint.conname);

    if (
      !expectedType ||
      seen.has(constraint.conname) ||
      constraint.contype !== expectedType ||
      constraint.convalidated !== true
    ) {
      throw new Error("Migration history table has an unexpected or unvalidated constraint");
    }

    seen.add(constraint.conname);

    const definition = constraint.definition;

    if (
      constraint.conname === "control_schema_migrations_pkey" &&
      !/PRIMARY KEY\s*\(version\)/i.test(definition)
    ) {
      throw new Error("Migration history primary key must cover version");
    }

    if (
      constraint.conname === "control_schema_migrations_filename_key" &&
      !/UNIQUE\s*\(filename\)/i.test(definition)
    ) {
      throw new Error("Migration history filename constraint must be unique");
    }

    if (
      constraint.conname === "control_schema_migrations_checksum_sha256_check"
    ) {
      assertExpectedConstraintDefinitions([constraint], {
        control_schema_migrations_checksum_sha256_check:
          "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))",
      });
    }
  }
}

/**
 * A fresh database must not contain unrelated objects in the public schema.
 * The caller supplies objects discovered from PostgreSQL system catalogs.
 */
export function assertFreshDatabaseHasNoPublicObjects(objects) {
  if (!Array.isArray(objects)) {
    throw new Error("Public schema inspection returned an invalid result");
  }

  if (objects.length > 0) {
    const names = objects
      .map((object) => String(object.object_name ?? "unknown"))
      .slice(0, 5);

    const suffix = objects.length > names.length ? ", ..." : "";

    throw new Error(
      `Fresh database check failed: public schema contains unrelated objects (${names.join(", ")}${suffix})`,
    );
  }
}

/**
 * Compare actual PostgreSQL index definitions with the expected schema.
 * Index names alone are insufficient: columns, uniqueness and sort order matter.
 */
export function assertExpectedIndexDefinitions(actual, expected) {
  const normalize = normalizeSqlDefinition;

  const actualByName = new Map();

  for (const index of actual) {
    if (actualByName.has(index.indexname)) {
      throw new Error(`Duplicate index definition: ${index.indexname}`);
    }
    actualByName.set(index.indexname, normalize(index.indexdef));
  }

  const expectedEntries = Object.entries(expected);
  const expectedNames = new Set(Object.keys(expected));

  if (
    actualByName.size !== expectedNames.size ||
    [...actualByName.keys()].some((name) => !expectedNames.has(name)) ||
    [...expectedNames].some((name) => !actualByName.has(name))
  ) {
    throw new Error("Index definition set differs from the expected schema");
  }

  for (const [name, expectedDefinition] of expectedEntries) {
    const actualDefinition = actualByName.get(name);

    if (
      actualDefinition === undefined ||
      actualDefinition !== normalize(expectedDefinition)
    ) {
      throw new Error(
        `Index definition differs from the expected schema: ${name}`,
      );
    }
  }
}

/**
 * Compare PostgreSQL constraint definitions without ignoring SQL operators,
 * column names, referenced tables, or constraint values.
 */
export function assertExpectedConstraintDefinitions(actual, expected) {
  const normalize = normalizeSqlDefinition;

  const actualByName = new Map();

  for (const constraint of actual) {
    if (actualByName.has(constraint.conname)) {
      throw new Error(
        `Duplicate constraint definition: ${constraint.conname}`,
      );
    }

    actualByName.set(constraint.conname, normalize(constraint.definition));
  }

  const expectedEntries = Object.entries(expected);

  if (actualByName.size !== expectedEntries.length) {
    throw new Error("Constraint definition set differs from the expected schema");
  }

  for (const [name, expectedDefinition] of expectedEntries) {
    const actualDefinition = actualByName.get(name);

    if (
      actualDefinition === undefined ||
      actualDefinition !== normalize(expectedDefinition)
    ) {
      throw new Error(
        `Constraint definition differs from the expected schema: ${name}`,
      );
    }
  }
}
