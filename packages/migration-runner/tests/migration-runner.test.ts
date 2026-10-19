import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertContiguousMigrationVersions,
  assertExpectedConstraintDefinitions,
  assertExpectedIndexDefinitions,
  assertFreshDatabaseHasNoPublicObjects,
  assertUniqueVersions,
  assertValidMigrationHistory,
  classifyDatabase,
  parseMigrationFilename,
  prepareMigrationSql,
  sha256,
} from "../src/index.js";

test("parses a valid migration filename", () => {
  assert.deepEqual(parseMigrationFilename("001_initial_registry.sql"), {
    version: "001",
    filename: "001_initial_registry.sql",
  });
});

test("rejects unsafe or invalid migration filenames", () => {
  for (const filename of [
    "1_initial.sql",
    "001_Initial.sql",
    "../001_initial.sql",
    "001_initial.txt",
  ]) {
    assert.throws(() => parseMigrationFilename(filename));
  }
});

test("calculates a stable SHA-256 checksum", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("strips only an outer transaction wrapper", () => {
  assert.equal(
    prepareMigrationSql(
      "BEGIN;\nCREATE TABLE sample (id integer);\nCOMMIT;",
      "001_sample.sql",
    ),
    "CREATE TABLE sample (id integer);",
  );
});

test("rejects incomplete and nested transaction wrappers", () => {
  assert.throws(
    () => prepareMigrationSql("BEGIN; SELECT 1;", "001_sample.sql"),
    /Invalid transaction wrapper/,
  );

  assert.throws(
    () =>
      prepareMigrationSql(
        "BEGIN; SELECT 1; BEGIN; SELECT 2; COMMIT;",
        "001_sample.sql",
      ),
    /Nested transaction control/,
  );
});

test("rejects transaction control in unwrapped SQL", () => {
  assert.throws(
    () => prepareMigrationSql("SELECT 1; COMMIT;", "002_sample.sql"),
    /Transaction control/,
  );
});

test("sorts migration versions numerically", () => {
  assert.deepEqual(
    assertUniqueVersions([
      { version: "010" },
      { version: "002" },
      { version: "001" },
    ]).map((migration) => migration.version),
    ["001", "002", "010"],
  );
});

test("rejects duplicate textual and numeric versions", () => {
  assert.throws(
    () => assertUniqueVersions([{ version: "001" }, { version: "001" }]),
    /Duplicate migration version/,
  );

  assert.throws(
    () => assertUniqueVersions([{ version: "001" }, { version: "1" }]),
    /Duplicate numeric migration version/,
  );
});

test("requires contiguous migration versions beginning at 001", () => {
  assert.deepEqual(
    assertContiguousMigrationVersions([
      { version: "002" },
      { version: "001" },
    ]).map((migration) => migration.version),
    ["001", "002"],
  );

  assert.throws(
    () => assertContiguousMigrationVersions([{ version: "002" }]),
    /first migration version must be 001/,
  );

  assert.throws(
    () =>
      assertContiguousMigrationVersions([
        { version: "001" },
        { version: "003" },
      ]),
    /version gap/,
  );
});

test("classifies fresh, untracked, and tracked database states", () => {
  assert.equal(
    classifyDatabase({ historyExists: false, registryTables: [] }),
    "fresh",
  );
  assert.equal(
    classifyDatabase({ historyExists: false, registryTables: ["projects"] }),
    "existing-untracked",
  );
  assert.equal(
    classifyDatabase({ historyExists: true, registryTables: [] }),
    "history-without-registry",
  );
  assert.equal(
    classifyDatabase({ historyExists: true, registryTables: ["projects"] }),
    "tracked",
  );
});

test("validates ordered migration history", () => {
  const migrations = [
    { version: "001", filename: "001_initial.sql" },
    { version: "002", filename: "002_second.sql" },
  ];

  assert.doesNotThrow(() =>
    assertValidMigrationHistory(
      [
        { version: "001", filename: "001_initial.sql" },
        { version: "002", filename: "002_second.sql" },
      ],
      migrations,
    ),
  );

  assert.throws(
    () =>
      assertValidMigrationHistory(
        [{ version: "002", filename: "002_second.sql" }],
        migrations,
      ),
    /history has a gap/,
  );

  assert.throws(
    () => assertValidMigrationHistory([], migrations),
    /history is empty/,
  );
});

test("rejects unrelated objects in a supposedly fresh schema", () => {
  assert.doesNotThrow(() => assertFreshDatabaseHasNoPublicObjects([]));
  assert.throws(
    () =>
      assertFreshDatabaseHasNoPublicObjects([
        { object_name: "projects" },
        { object_name: "unrelated_table" },
      ]),
    /contains unrelated objects/,
  );
});

test("compares index definitions, not just names", () => {
  assert.doesNotThrow(() =>
    assertExpectedIndexDefinitions(
      [{ indexname: "idx_sample", indexdef: "CREATE INDEX idx_sample ON public.sample USING btree (id)" }],
      { idx_sample: "create index idx_sample on public.sample using btree(id)" },
    ),
  );

  assert.throws(
    () =>
      assertExpectedIndexDefinitions(
        [{ indexname: "idx_sample", indexdef: "CREATE INDEX idx_sample ON public.sample (name)" }],
        { idx_sample: "CREATE INDEX idx_sample ON public.sample (id)" },
      ),
    /Index definition differs/,
  );
});

test("compares constraint definitions without ignoring values", () => {
  assert.doesNotThrow(() =>
    assertExpectedConstraintDefinitions(
      [{ conname: "sample_check", definition: "CHECK ((status = 'active'::text))" }],
      { sample_check: "check((status='active'::text))" },
    ),
  );

  assert.throws(
    () =>
      assertExpectedConstraintDefinitions(
        [{ conname: "sample_check", definition: "CHECK ((status = 'inactive'::text))" }],
        { sample_check: "CHECK ((status = 'active'::text))" },
      ),
    /Constraint definition differs/,
  );
});
