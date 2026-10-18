import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExpectedConstraintDefinitions,
  assertExpectedIndexDefinitions,
  assertSafeControlMigrationDatabase,
  assertFreshDatabaseHasNoPublicObjects,
} from "../scripts/control-migrations-lib.mjs";

import {
  assertContiguousMigrationVersions,
  assertValidHistoryTableSchema,
  assertUniqueVersions,
  assertValidMigrationHistory,
  classifyDatabase,
  parseMigrationFilename,
  prepareMigrationSql,
  sha256,
} from "../scripts/control-migrations-lib.mjs";


test("allows a dedicated control migration test database", () => {
  assert.doesNotThrow(() =>
    assertSafeControlMigrationDatabase("ppm_test_control_runner"),
  );
});

test("refuses the protected platform control database", () => {
  assert.throws(
    () => assertSafeControlMigrationDatabase("platform_control_db"),
    /Refusing to run control migrations against the protected database/,
  );
});

test("rejects invalid control migration database names", () => {
  for (const database of ["", " ", " platform_control_db", "platform_control_db "]) {
    assert.throws(
      () => assertSafeControlMigrationDatabase(database),
      /Invalid control migration database name/,
    );
  }
});

test("accepts a correctly formatted migration filename", () => {
  assert.deepEqual(parseMigrationFilename("001_initial_registry.sql"), {
    version: "001",
    filename: "001_initial_registry.sql",
  });
});

test("rejects invalid migration filenames", () => {
  for (const filename of [
    "initial_registry.sql",
    "1_initial_registry.sql",
    "001_Initial_Registry.sql",
    "../001_initial_registry.sql",
    "001_initial_registry.txt",
  ]) {
    assert.throws(() => parseMigrationFilename(filename));
  }
});

test("sorts migrations by numeric version", () => {
  const result = assertUniqueVersions([
    { version: "010" },
    { version: "002" },
    { version: "001" },
  ]);

  assert.deepEqual(result.map((item) => item.version), ["001", "002", "010"]);
});

test("rejects duplicate migration versions", () => {
  assert.throws(
    () => assertUniqueVersions([
      { version: "001" },
      { version: "001" },
    ]),
    /Duplicate migration version/,
  );
});

test("strips only an outer transaction wrapper", () => {
  assert.equal(
    prepareMigrationSql("BEGIN;\nCREATE TABLE sample (id integer);\nCOMMIT;", "001_sample.sql"),
    "CREATE TABLE sample (id integer);",
  );
});

test("rejects incomplete transaction wrappers", () => {
  assert.throws(
    () => prepareMigrationSql("BEGIN; CREATE TABLE sample (id integer);", "001_sample.sql"),
    /Invalid transaction wrapper/,
  );
});

test("rejects transaction control statements in unwrapped migrations", () => {
  assert.throws(
    () => prepareMigrationSql("CREATE TABLE sample (id integer); COMMIT;", "002_sample.sql"),
    /Transaction control/,
  );
});

test("calculates a stable SHA-256 checksum", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("classifies a fresh database", () => {
  assert.equal(
    classifyDatabase({ historyExists: false, registryTables: [] }),
    "fresh",
  );
});

test("classifies an existing registry without history", () => {
  assert.equal(
    classifyDatabase({
      historyExists: false,
      registryTables: ["projects"],
    }),
    "existing-untracked",
  );
});

test("refuses to treat history without registry tables as fresh", () => {
  assert.equal(
    classifyDatabase({ historyExists: true, registryTables: [] }),
    "history-without-registry",
  );
});

test("classifies a database with migration history and registry tables", () => {
  assert.equal(
    classifyDatabase({
      historyExists: true,
      registryTables: ["projects", "database_instances"],
    }),
    "tracked",
  );
});


test("accepts a contiguous migration history", () => {
  assert.doesNotThrow(() =>
    assertValidMigrationHistory(
      [
        { version: "001", filename: "001_initial_registry.sql" },
        { version: "002", filename: "002_add_example.sql" },
      ],
      [
        { version: "001", filename: "001_initial_registry.sql" },
        { version: "002", filename: "002_add_example.sql" },
        { version: "003", filename: "003_next.sql" },
      ],
    ),
  );
});

test("rejects empty history for a tracked database", () => {
  assert.throws(
    () => assertValidMigrationHistory([], [
      { version: "001", filename: "001_initial_registry.sql" },
    ]),
    /history is empty/,
  );
});

test("rejects migration history that skips version 001", () => {
  assert.throws(
    () => assertValidMigrationHistory(
      [{ version: "002", filename: "002_add_example.sql" }],
      [
        { version: "001", filename: "001_initial_registry.sql" },
        { version: "002", filename: "002_add_example.sql" },
      ],
    ),
    /history has a gap/,
  );
});

test("rejects gaps in migration history", () => {
  assert.throws(
    () => assertValidMigrationHistory(
      [
        { version: "001", filename: "001_initial_registry.sql" },
        { version: "003", filename: "003_next.sql" },
      ],
      [
        { version: "001", filename: "001_initial_registry.sql" },
        { version: "002", filename: "002_add_example.sql" },
        { version: "003", filename: "003_next.sql" },
      ],
    ),
    /history has a gap/,
  );
});

test("rejects migration files with a missing version", () => {
  assert.throws(
    () => assertContiguousMigrationVersions([
      { version: "001", filename: "001_initial_registry.sql" },
      { version: "003", filename: "003_next.sql" },
    ]),
    /version gap: expected 002/,
  );
});

test("rejects migration files that do not start at 001", () => {
  assert.throws(
    () => assertContiguousMigrationVersions([
      { version: "002", filename: "002_next.sql" },
    ]),
    /first migration version must be 001/,
  );
});


test("rejects numerically duplicate versions with different padding", () => {
  assert.throws(
    () => assertUniqueVersions([
      { version: "001" },
      { version: "0001" },
    ]),
    /Duplicate numeric migration version/,
  );
});


test("accepts the expected migration history table schema", () => {
  const columns = [
    { column_name: "version", data_type: "text", udt_name: "text", is_nullable: "NO", character_maximum_length: null, column_default: null },
    { column_name: "filename", data_type: "text", udt_name: "text", is_nullable: "NO", character_maximum_length: null, column_default: null },
    { column_name: "checksum_sha256", data_type: "character", udt_name: "bpchar", is_nullable: "NO", character_maximum_length: 64, column_default: null },
    { column_name: "applied_at", data_type: "timestamp with time zone", udt_name: "timestamptz", is_nullable: "NO", character_maximum_length: null, column_default: "now()" },
  ];

  const constraints = [
    { conname: "control_schema_migrations_pkey", contype: "p", convalidated: true, definition: "PRIMARY KEY (version)" },
    { conname: "control_schema_migrations_filename_key", contype: "u", convalidated: true, definition: "UNIQUE (filename)" },
    { conname: "control_schema_migrations_checksum_sha256_check", contype: "c", convalidated: true, definition: "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))" },
  ];

  assert.doesNotThrow(() => assertValidHistoryTableSchema(columns, constraints));

  // A matching regex substring must not allow additional constraint logic.
  constraints[2].definition =
    "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text) OR true)";
  assert.throws(
    () => assertValidHistoryTableSchema(columns, constraints),
    /Constraint definition differs/,
  );

  // The complete regex expression must match the expected checksum format.
  constraints[2].definition =
    "CHECK ((checksum_sha256 ~ '^[0-9a-f]+$'::text))";
  assert.throws(
    () => assertValidHistoryTableSchema(columns, constraints),
    /Constraint definition differs/,
  );
});

test("rejects an altered migration history column", () => {
  const columns = [
    { column_name: "version", data_type: "text", udt_name: "text", is_nullable: "YES", character_maximum_length: null, column_default: null },
    { column_name: "filename", data_type: "text", udt_name: "text", is_nullable: "NO", character_maximum_length: null, column_default: null },
    { column_name: "checksum_sha256", data_type: "character", udt_name: "bpchar", is_nullable: "NO", character_maximum_length: 64, column_default: null },
    { column_name: "applied_at", data_type: "timestamp with time zone", udt_name: "timestamptz", is_nullable: "NO", character_maximum_length: null, column_default: "now()" },
  ];

  const constraints = [
    { conname: "control_schema_migrations_pkey", contype: "p", convalidated: true, definition: "PRIMARY KEY (version)" },
    { conname: "control_schema_migrations_filename_key", contype: "u", convalidated: true, definition: "UNIQUE (filename)" },
    { conname: "control_schema_migrations_checksum_sha256_check", contype: "c", convalidated: true, definition: "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))" },
  ];

  assert.throws(
    () => assertValidHistoryTableSchema(columns, constraints),
    /columns, types, nullability or defaults/,
  );
});

test("rejects an unvalidated migration history constraint", () => {
  const columns = [
    { column_name: "version", data_type: "text", udt_name: "text", is_nullable: "NO", character_maximum_length: null, column_default: null },
    { column_name: "filename", data_type: "text", udt_name: "text", is_nullable: "NO", character_maximum_length: null, column_default: null },
    { column_name: "checksum_sha256", data_type: "character", udt_name: "bpchar", is_nullable: "NO", character_maximum_length: 64, column_default: null },
    { column_name: "applied_at", data_type: "timestamp with time zone", udt_name: "timestamptz", is_nullable: "NO", character_maximum_length: null, column_default: "now()" },
  ];

  const constraints = [
    { conname: "control_schema_migrations_pkey", contype: "p", convalidated: true, definition: "PRIMARY KEY (version)" },
    { conname: "control_schema_migrations_filename_key", contype: "u", convalidated: true, definition: "UNIQUE (filename)" },
    { conname: "control_schema_migrations_checksum_sha256_check", contype: "c", convalidated: false, definition: "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))" },
  ];

  assert.throws(
    () => assertValidHistoryTableSchema(columns, constraints),
    /unexpected or unvalidated constraint/,
  );
});


test("accepts an empty public schema for fresh initialization", () => {
  assert.doesNotThrow(() => assertFreshDatabaseHasNoPublicObjects([]));
});

test("rejects unrelated public relations in a supposedly fresh database", () => {
  assert.throws(
    () =>
      assertFreshDatabaseHasNoPublicObjects([
        { object_name: "unrelated_idx", object_kind: "relation:i" },
      ]),
    /public schema contains unrelated objects/,
  );
});

test("rejects public-schema routines in a supposedly fresh database", () => {
  assert.throws(
    () =>
      assertFreshDatabaseHasNoPublicObjects([
        { object_name: "custom_function", object_kind: "routine" },
      ]),
    /public schema contains unrelated objects/,
  );
});

test("preserves case-sensitive index predicate literals", () => {
  assert.throws(
    () =>
      assertExpectedIndexDefinitions(
        [
          {
            indexname: "sample_status_idx",
            indexdef:
              "CREATE INDEX sample_status_idx ON public.sample USING btree (status) WHERE (status = 'Active'::text)",
          },
        ],
        {
          sample_status_idx:
            "CREATE INDEX sample_status_idx ON public.sample USING btree (status) WHERE (status = 'active'::text)",
        },
      ),
    /Index definition differs/,
  );
});

test("accepts exact expected index definitions", () => {
  assert.doesNotThrow(() =>
    assertExpectedIndexDefinitions(
      [
        {
          indexname: "sample_pkey",
          indexdef:
            "CREATE UNIQUE INDEX sample_pkey ON public.sample USING btree (id)",
        },
        {
          indexname: "sample_created_idx",
          indexdef:
            "CREATE INDEX sample_created_idx ON public.sample USING btree (created_at DESC)",
        },
      ],
      {
        sample_pkey:
          "CREATE UNIQUE INDEX sample_pkey ON public.sample USING btree (id)",
        sample_created_idx:
          "CREATE INDEX sample_created_idx ON public.sample USING btree (created_at DESC)",
      },
    ),
  );
});

test("rejects an index with incorrect columns or sort order", () => {
  assert.throws(
    () =>
      assertExpectedIndexDefinitions(
        [
          {
            indexname: "sample_created_idx",
            indexdef:
              "CREATE INDEX sample_created_idx ON public.sample USING btree (created_at)",
          },
        ],
        {
          sample_created_idx:
            "CREATE INDEX sample_created_idx ON public.sample USING btree (created_at DESC)",
        },
      ),
    /Index definition differs/,
  );
});

test("rejects missing or unexpected indexes", () => {
  assert.throws(
    () =>
      assertExpectedIndexDefinitions(
        [
          {
            indexname: "unexpected_idx",
            indexdef:
              "CREATE INDEX unexpected_idx ON public.sample USING btree (id)",
          },
        ],
        {
          sample_pkey:
            "CREATE UNIQUE INDEX sample_pkey ON public.sample USING btree (id)",
        },
      ),
    /Index definition set differs/,
  );
});

test("preserves meaningful whitespace inside constraint literals", () => {
  assert.throws(
    () =>
      assertExpectedConstraintDefinitions(
        [
          {
            conname: "state_check",
            definition: "CHECK ((state = 'queued  for review'::text))",
          },
        ],
        {
          state_check: "CHECK ((state = 'queued for review'::text))",
        },
      ),
    /Constraint definition differs/,
  );
});

test("accepts an exact expected constraint definition set", () => {
  assert.doesNotThrow(() =>
    assertExpectedConstraintDefinitions(
      [
        { conname: "projects_pkey", definition: "PRIMARY KEY (id)" },
        {
          conname: "projects_status_check",
          definition:
            "CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))",
        },
      ],
      {
        projects_pkey: "PRIMARY KEY (id)",
        projects_status_check:
          "CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))",
      },
    ),
  );
});

test("rejects altered check constraint values", () => {
  assert.throws(
    () =>
      assertExpectedConstraintDefinitions(
        [
          {
            conname: "projects_status_check",
            definition:
              "CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))",
          },
        ],
        {
          projects_status_check:
            "CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))",
        },
      ),
    /definition differs/,
  );
});

test("rejects a foreign key pointing at the wrong table", () => {
  assert.throws(
    () =>
      assertExpectedConstraintDefinitions(
        [
          {
            conname: "database_instances_project_id_fkey",
            definition:
              "FOREIGN KEY (project_id) REFERENCES another_table(id)",
          },
        ],
        {
          database_instances_project_id_fkey:
            "FOREIGN KEY (project_id) REFERENCES projects(id)",
        },
      ),
    /definition differs/,
  );
});

test("rejects a missing or unexpected constraint", () => {
  assert.throws(
    () =>
      assertExpectedConstraintDefinitions(
        [{ conname: "projects_pkey", definition: "PRIMARY KEY (id)" }],
        {
          projects_pkey: "PRIMARY KEY (id)",
          projects_status_check: "CHECK (status = 'active'::text)",
        },
      ),
    /definition set differs/,
  );
});
