import { createHash } from "node:crypto";

export interface MigrationFile {
  version: string;
  filename: string;
  checksum?: string;
  sql?: string;
}

export interface MigrationHistoryRow {
  version: string;
  filename: string;
  checksum_sha256?: string;
}

export interface DatabaseClassificationInput {
  historyExists: boolean;
  registryTables: readonly unknown[];
}

export interface HistoryColumn {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  character_maximum_length: number | string | null;
  column_default: string | null;
}

export interface HistoryConstraint {
  conname: string;
  contype: string;
  convalidated: boolean;
  definition: string;
}

export interface IndexDefinition {
  indexname: string;
  indexdef: string;
}

export interface ConstraintDefinition {
  conname: string;
  definition: string;
}

function normalizeSqlDefinition(definition: string): string {
  const source = String(definition);
  const parts: string[] = [];
  let segmentStart = 0;
  let index = 0;

  const pushUnquoted = (end: number): void => {
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
        (index < 2 || !/[A-Za-z0-9_$]/.test(source[index - 2] ?? ""));

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
      const match = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);

      if (match) {
        pushUnquoted(index);

        const delimiter = match[0];
        const closeAt = source.indexOf(delimiter, index + delimiter.length);
        const end =
          closeAt === -1 ? source.length : closeAt + delimiter.length;

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

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function parseMigrationFilename(
  filename: string,
): { version: string; filename: string } {
  const match = /^([0-9]{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/.exec(filename);

  if (!match) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }

  return { version: match[1], filename };
}

export function prepareMigrationSql(
  content: string,
  filename: string,
): string {
  const wrapped =
    /^\s*BEGIN\s*;\s*([\s\S]*?)\s*COMMIT\s*;\s*$/i.exec(content);

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

export function classifyDatabase({
  historyExists,
  registryTables,
}: DatabaseClassificationInput):
  | "fresh"
  | "existing-untracked"
  | "tracked"
  | "history-without-registry" {
  if (historyExists) {
    if (registryTables.length === 0) return "history-without-registry";
    return "tracked";
  }

  if (registryTables.length === 0) return "fresh";
  return "existing-untracked";
}

export function assertUniqueVersions<T extends { version: string }>(
  migrations: readonly T[],
): T[] {
  const seen = new Set<string>();
  const numericVersions = new Set<number>();

  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);

    const numericVersion = Number(migration.version);
    if (numericVersions.has(numericVersion)) {
      throw new Error(
        `Duplicate numeric migration version: ${migration.version}`,
      );
    }
    numericVersions.add(numericVersion);
  }

  return [...migrations].sort(
    (a, b) => Number(a.version) - Number(b.version),
  );
}

export function assertContiguousMigrationVersions<T extends { version: string }>(
  migrations: readonly T[],
): T[] {
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

export function assertValidMigrationHistory(
  historyRows: readonly MigrationHistoryRow[],
  migrations: readonly MigrationFile[],
): void {
  if (historyRows.length === 0) {
    throw new Error("Migration history is empty for a tracked database");
  }

  const ordered = [...migrations].sort((a, b) =>
    a.version.localeCompare(b.version, "en", { numeric: true }),
  );

  if (historyRows.length > ordered.length) {
    throw new Error(
      "Migration history contains more entries than available migration files",
    );
  }

  const appliedVersions = new Set<string>();

  for (const row of historyRows) {
    if (appliedVersions.has(row.version)) {
      throw new Error(`Duplicate migration history version: ${row.version}`);
    }

    const migration = ordered.find(
      (candidate) => candidate.version === row.version,
    );

    if (!migration) {
      throw new Error(`Applied migration file is missing: ${row.filename}`);
    }

    if (row.filename !== migration.filename) {
      throw new Error(
        `Migration history filename mismatch for version ${row.version}: expected ${migration.filename}, found ${row.filename}`,
      );
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

export function assertValidHistoryTableSchema(
  columns: readonly HistoryColumn[],
  constraints: readonly HistoryConstraint[],
): void {
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
    throw new Error(
      "Migration history table columns, types, nullability or defaults differ from the expected schema",
    );
  }

  const expectedConstraintTypes = new Map([
    ["control_schema_migrations_pkey", "p"],
    ["control_schema_migrations_filename_key", "u"],
    ["control_schema_migrations_checksum_sha256_check", "c"],
  ]);

  if (constraints.length !== expectedConstraintTypes.size) {
    throw new Error("Migration history table has an unexpected constraint set");
  }

  const seen = new Set<string>();

  for (const constraint of constraints) {
    const expectedType = expectedConstraintTypes.get(constraint.conname);

    if (
      !expectedType ||
      seen.has(constraint.conname) ||
      constraint.contype !== expectedType ||
      constraint.convalidated !== true
    ) {
      throw new Error(
        "Migration history table has an unexpected or unvalidated constraint",
      );
    }

    seen.add(constraint.conname);

    if (
      constraint.conname === "control_schema_migrations_pkey" &&
      !/PRIMARY KEY\s*\(version\)/i.test(constraint.definition)
    ) {
      throw new Error("Migration history primary key must cover version");
    }

    if (
      constraint.conname === "control_schema_migrations_filename_key" &&
      !/UNIQUE\s*\(filename\)/i.test(constraint.definition)
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

export function assertFreshDatabaseHasNoPublicObjects(
  objects: readonly { object_name?: unknown }[],
): void {
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

export function assertExpectedIndexDefinitions(
  actual: readonly IndexDefinition[],
  expected: Readonly<Record<string, string>>,
): void {
  const actualByName = new Map<string, string>();

  for (const index of actual) {
    if (actualByName.has(index.indexname)) {
      throw new Error(`Duplicate index definition: ${index.indexname}`);
    }

    actualByName.set(index.indexname, normalizeSqlDefinition(index.indexdef));
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
      actualDefinition !== normalizeSqlDefinition(expectedDefinition)
    ) {
      throw new Error(
        `Index definition differs from the expected schema: ${name}`,
      );
    }
  }
}

export function assertExpectedConstraintDefinitions(
  actual: readonly ConstraintDefinition[],
  expected: Readonly<Record<string, string>>,
): void {
  const actualByName = new Map<string, string>();

  for (const constraint of actual) {
    if (actualByName.has(constraint.conname)) {
      throw new Error(
        `Duplicate constraint definition: ${constraint.conname}`,
      );
    }

    actualByName.set(
      constraint.conname,
      normalizeSqlDefinition(constraint.definition),
    );
  }

  const expectedEntries = Object.entries(expected);

  if (actualByName.size !== expectedEntries.length) {
    throw new Error(
      "Constraint definition set differs from the expected schema",
    );
  }

  for (const [name, expectedDefinition] of expectedEntries) {
    const actualDefinition = actualByName.get(name);

    if (
      actualDefinition === undefined ||
      actualDefinition !== normalizeSqlDefinition(expectedDefinition)
    ) {
      throw new Error(
        `Constraint definition differs from the expected schema: ${name}`,
      );
    }
  }
}
