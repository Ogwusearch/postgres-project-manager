import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { config } from "dotenv";

import {
  assertContiguousMigrationVersions,
  assertSafeControlMigrationDatabase,
  assertExpectedConstraintDefinitions,
  assertExpectedIndexDefinitions,
  assertFreshDatabaseHasNoPublicObjects,
  assertValidHistoryTableSchema,
  assertValidMigrationHistory,
  classifyDatabase,
  parseMigrationFilename,
  prepareMigrationSql,
  sha256,
} from "./control-migrations-lib.mjs";

config();

const { Client } = pg;
const migrationDirectory = resolve("database/control-migrations");
const baselineRequested = process.argv.includes("--baseline-existing");
const lockKeys = [73198420, 11235813];

const expectedColumns = {
  projects: [
    ["id", "uuid", "NO"],
    ["project_key", "text", "NO"],
    ["name", "text", "NO"],
    ["status", "text", "NO"],
    ["created_at", "timestamptz", "NO"],
  ],
  database_instances: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["environment", "text", "NO"],
    ["database_name", "text", "NO"],
    ["server_key", "text", "NO"],
    ["status", "text", "NO"],
    ["created_at", "timestamptz", "NO"],
  ],
  migration_runs: [
    ["id", "uuid", "NO"],
    ["database_instance_id", "uuid", "NO"],
    ["migration_version", "text", "NO"],
    ["status", "text", "NO"],
    ["started_at", "timestamptz", "NO"],
    ["finished_at", "timestamptz", "YES"],
    ["error_summary", "text", "YES"],
  ],
  backup_runs: [
    ["id", "uuid", "NO"],
    ["database_instance_id", "uuid", "NO"],
    ["backup_location", "text", "YES"],
    ["checksum_sha256", "text", "YES"],
    ["status", "text", "NO"],
    ["started_at", "timestamptz", "NO"],
    ["finished_at", "timestamptz", "YES"],
    ["restore_tested_at", "timestamptz", "YES"],
  ],
  audit_events: [
    ["id", "uuid", "NO"],
    ["actor", "text", "NO"],
    ["action", "text", "NO"],
    ["target", "text", "NO"],
    ["outcome", "text", "NO"],
    ["details", "jsonb", "NO"],
    ["created_at", "timestamptz", "NO"],
  ],
};



const expectedConstraints = [
  "projects_pkey",
  "projects_project_key_key",
  "projects_status_check",
  "database_instances_pkey",
  "database_instances_database_name_key",
  "database_instances_project_id_environment_key",
  "database_instances_project_id_fkey",
  "database_instances_environment_check",
  "database_instances_status_check",
  "migration_runs_pkey",
  "migration_runs_database_instance_id_fkey",
  "migration_runs_status_check",
  "backup_runs_pkey",
  "backup_runs_database_instance_id_fkey",
  "backup_runs_status_check",
  "audit_events_pkey",
  "audit_events_outcome_check",
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadMigrations() {
  const files = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) throw new Error("No control migrations found");

  const migrations = [];

  for (const filename of files) {
    const parsed = parseMigrationFilename(filename);
    const content = await readFile(resolve(migrationDirectory, filename), "utf8");

    migrations.push({
      ...parsed,
      content,
      checksum: sha256(content),
    });
  }

  return assertContiguousMigrationVersions(migrations);
}

async function inspectRegistry(client) {
  const tables = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  const objects = await client.query(`
    SELECT object_name, object_kind
    FROM (
      SELECT c.relname AS object_name,
             ('relation:' || c.relkind::text)::text AS object_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT p.proname, 'routine'
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT t.typname, ('type:' || t.typtype::text)::text
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typrelid = 0

      UNION ALL
      SELECT o.oprname, 'operator'
      FROM pg_operator o
      JOIN pg_namespace n ON n.oid = o.oprnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.opcname, 'operator-class'
      FROM pg_opclass x
      JOIN pg_namespace n ON n.oid = x.opcnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.opfname, 'operator-family'
      FROM pg_opfamily x
      JOIN pg_namespace n ON n.oid = x.opfnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.conname, 'conversion'
      FROM pg_conversion x
      JOIN pg_namespace n ON n.oid = x.connamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.collname, 'collation'
      FROM pg_collation x
      JOIN pg_namespace n ON n.oid = x.collnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.dictname, 'text-search-dictionary'
      FROM pg_ts_dict x
      JOIN pg_namespace n ON n.oid = x.dictnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.cfgname, 'text-search-configuration'
      FROM pg_ts_config x
      JOIN pg_namespace n ON n.oid = x.cfgnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.prsname, 'text-search-parser'
      FROM pg_ts_parser x
      JOIN pg_namespace n ON n.oid = x.prsnamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT x.tmplname, 'text-search-template'
      FROM pg_ts_template x
      JOIN pg_namespace n ON n.oid = x.tmplnamespace
      WHERE n.nspname = 'public'
    ) public_objects
    ORDER BY object_name, object_kind
  `);

  const allTables = tables.rows.map((row) => row.tablename);
  const registryTables = allTables
    .filter((name) => Object.hasOwn(expectedColumns, name));

  return {
    allTables,
    registryTables,
    publicObjects: objects.rows,
  };
}

async function verifyExistingSchema(client) {
  const { allTables } = await inspectRegistry(client);
  const expectedTables = Object.keys(expectedColumns).sort();

  if (JSON.stringify(allTables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Cannot baseline: public table set differs. Found: ${allTables.join(", ") || "(none)"}`,
    );
  }

  const columns = await client.query(`
    SELECT table_name, column_name, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  for (const [table, expected] of Object.entries(expectedColumns)) {
    const actual = columns.rows
      .filter((row) => row.table_name === table)
      .map((row) => [row.column_name, row.udt_name, row.is_nullable]);

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Cannot baseline: column names, types or nullability differ for ${table}`);
    }
  }

  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY indexname
  `);

  assertExpectedIndexDefinitions(indexes.rows, {
    projects_pkey:
      "CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id)",
    projects_project_key_key:
      "CREATE UNIQUE INDEX projects_project_key_key ON public.projects USING btree (project_key)",
    database_instances_pkey:
      "CREATE UNIQUE INDEX database_instances_pkey ON public.database_instances USING btree (id)",
    database_instances_database_name_key:
      "CREATE UNIQUE INDEX database_instances_database_name_key ON public.database_instances USING btree (database_name)",
    database_instances_project_id_environment_key:
      "CREATE UNIQUE INDEX database_instances_project_id_environment_key ON public.database_instances USING btree (project_id, environment)",
    idx_database_instances_project:
      "CREATE INDEX idx_database_instances_project ON public.database_instances USING btree (project_id)",
    migration_runs_pkey:
      "CREATE UNIQUE INDEX migration_runs_pkey ON public.migration_runs USING btree (id)",
    idx_migration_runs_instance:
      "CREATE INDEX idx_migration_runs_instance ON public.migration_runs USING btree (database_instance_id, started_at DESC)",
    backup_runs_pkey:
      "CREATE UNIQUE INDEX backup_runs_pkey ON public.backup_runs USING btree (id)",
    idx_backup_runs_instance:
      "CREATE INDEX idx_backup_runs_instance ON public.backup_runs USING btree (database_instance_id, started_at DESC)",
    audit_events_pkey:
      "CREATE UNIQUE INDEX audit_events_pkey ON public.audit_events USING btree (id)",
    idx_audit_events_created:
      "CREATE INDEX idx_audit_events_created ON public.audit_events USING btree (created_at DESC)",
  });

  const constraints = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  `);

  const actualConstraints = constraints.rows.map((row) => row.conname).sort();

  if (
    JSON.stringify(actualConstraints) !==
    JSON.stringify([...expectedConstraints].sort())
  ) {
    throw new Error("Cannot baseline: constraint names differ from migration 001");
  }

  // Check critical defaults and check-constraint definitions as well.
  const defaults = await client.query(`
    SELECT table_name, column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const defaultMap = new Map(
    defaults.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.column_default,
    ]),
  );

  const requiredDefaults = [
    ["projects.status", "'active'::text"],
    ["projects.created_at", "now()"],
    ["database_instances.environment", null],
    ["database_instances.server_key", "'local-postgres'::text"],
    ["database_instances.status", "'planned'::text"],
    ["database_instances.created_at", "now()"],
    ["migration_runs.started_at", "now()"],
    ["backup_runs.started_at", "now()"],
    ["audit_events.details", "'{}'::jsonb"],
    ["audit_events.created_at", "now()"],
  ];

  for (const [key, expected] of requiredDefaults) {
    if (defaultMap.get(key) !== expected) {
      throw new Error(`Cannot baseline: unexpected default for ${key}`);
    }
  }

  const constraintDefinitions = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY conname
  `);

  const requiredConstraintDefinitions = {
    projects_pkey: "PRIMARY KEY (id)",
    projects_project_key_key: "UNIQUE (project_key)",
    projects_status_check:
      "CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))",
    database_instances_pkey: "PRIMARY KEY (id)",
    database_instances_database_name_key: "UNIQUE (database_name)",
    database_instances_project_id_environment_key:
      "UNIQUE (project_id, environment)",
    database_instances_project_id_fkey:
      "FOREIGN KEY (project_id) REFERENCES projects(id)",
    database_instances_environment_check:
      "CHECK ((environment = ANY (ARRAY['development'::text, 'staging'::text, 'production'::text])))",
    database_instances_status_check:
      "CHECK ((status = ANY (ARRAY['planned'::text, 'provisioning'::text, 'ready'::text, 'failed'::text, 'retired'::text])))",
    migration_runs_pkey: "PRIMARY KEY (id)",
    migration_runs_database_instance_id_fkey:
      "FOREIGN KEY (database_instance_id) REFERENCES database_instances(id)",
    migration_runs_status_check:
      "CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])))",
    backup_runs_pkey: "PRIMARY KEY (id)",
    backup_runs_database_instance_id_fkey:
      "FOREIGN KEY (database_instance_id) REFERENCES database_instances(id)",
    backup_runs_status_check:
      "CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])))",
    audit_events_pkey: "PRIMARY KEY (id)",
    audit_events_outcome_check:
      "CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'failed'::text])))",
  };

  assertExpectedConstraintDefinitions(
    constraintDefinitions.rows,
    requiredConstraintDefinitions,
  );
}

async function verifyHistoryTableSchema(client) {
  const columns = await client.query(`
    SELECT column_name, data_type, udt_name, is_nullable,
           character_maximum_length, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'control_schema_migrations'
    ORDER BY ordinal_position
  `);

  const constraints = await client.query(`
    SELECT conname, contype, convalidated,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.control_schema_migrations'::regclass
    ORDER BY conname
  `);

  assertValidHistoryTableSchema(columns.rows, constraints.rows);
}

async function createHistoryTable(client) {
  await client.query(`
    CREATE TABLE public.control_schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum_sha256 CHAR(64) NOT NULL
        CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function main() {
  if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--baseline-existing")) {
    throw new Error("Unsupported command-line option");
  }

  const database = requiredEnv("CONTROL_MIGRATION_DATABASE");
  assertSafeControlMigrationDatabase(database);
  const user = requiredEnv("CONTROL_MIGRATION_USER");
  const password = requiredEnv("CONTROL_MIGRATION_PASSWORD");
  const host = requiredEnv("CONTROL_MIGRATION_HOST");
  const port = Number(process.env.CONTROL_MIGRATION_PORT || "55433");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid CONTROL_MIGRATION_PORT");
  }

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    connectionTimeoutMillis: 5000,
    application_name: "ppm-control-migration-runner",
  });

  let connected = false;
  let lockHeld = false;

  try {
    await client.connect();
    connected = true;

    const identity = await client.query(`
      SELECT current_database() AS database_name, current_user AS role_name
    `);

    if (identity.rows[0].database_name !== database) {
      throw new Error("Connected database does not match configured database");
    }

    console.log(
      `Connected to ${identity.rows[0].database_name} as ${identity.rows[0].role_name}`,
    );

    await client.query("SELECT pg_advisory_lock($1, $2)", lockKeys);
    lockHeld = true;

    const migrations = await loadMigrations();
    const first = migrations[0];

    if (first.version !== "001") {
      throw new Error("The first control migration must have version 001");
    }

    const historyCheck = await client.query(`
      SELECT to_regclass('public.control_schema_migrations') IS NOT NULL AS exists
    `);
    const historyExists = historyCheck.rows[0].exists;
    const { allTables, registryTables, publicObjects } = await inspectRegistry(client);

    const state = classifyDatabase({ historyExists, registryTables });

    if (state === "history-without-registry") {
      throw new Error("Migration history exists without registry tables; refusing to continue");
    }

    if (state === "existing-untracked") {
      if (!baselineRequested) {
        throw new Error(
          "Registry exists without migration history. Verify the schema and use --baseline-existing explicitly.",
        );
      }

      await verifyExistingSchema(client);

      await client.query("BEGIN");
      try {
        await createHistoryTable(client);
        await client.query(
          `INSERT INTO public.control_schema_migrations
             (version, filename, checksum_sha256)
           VALUES ($1, $2, $3)`,
          [first.version, first.filename, first.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure; client.end() runs in finally.
        }
        throw error;
      }

      console.log(`Baselined ${first.filename}; its SQL was not re-executed.`);
    } else if (state === "fresh") {
      if (baselineRequested) {
        throw new Error("Cannot baseline an empty database; run migrations normally");
      }

      // Refuse databases containing unrelated public objects.
      assertFreshDatabaseHasNoPublicObjects(publicObjects);

      // The history table is created atomically with migration 001 below.
      // If that migration fails, PostgreSQL rolls back the entire initialization.
    } else if (baselineRequested) {
      throw new Error("Database already has migration history; baseline is not applicable");
    }

    if (state !== "fresh") {
      await verifyHistoryTableSchema(client);
    }

    const history = state === "fresh"
      ? { rows: [] }
      : await client.query(`
          SELECT version, filename, checksum_sha256
          FROM public.control_schema_migrations
          ORDER BY version
        `);

    // Fresh databases begin with empty history. Existing databases must
    // have a non-empty, contiguous history before any migration can run.
    if (state !== "fresh") {
      assertValidMigrationHistory(history.rows, migrations);
    }

    const applied = new Map(history.rows.map((row) => [row.version, row]));
    const knownVersions = new Set(migrations.map((item) => item.version));

    for (const row of history.rows) {
      if (!knownVersions.has(row.version)) {
        throw new Error(`Applied migration file is missing: ${row.filename}`);
      }
    }

    let initializeFreshDatabase = state === "fresh";

    for (const migration of migrations) {
      const prior = applied.get(migration.version);

      if (prior) {
        if (
          prior.filename !== migration.filename ||
          prior.checksum_sha256.trim() !== migration.checksum
        ) {
          throw new Error(`Migration checksum or filename mismatch: ${migration.version}`);
        }

        console.log(`Already applied: ${migration.filename}`);
        continue;
      }

      const sql = prepareMigrationSql(migration.content, migration.filename);

      await client.query("BEGIN");
      try {
        if (initializeFreshDatabase) {
          await createHistoryTable(client);
        }

        await client.query(sql);
        await client.query(
          `INSERT INTO public.control_schema_migrations
             (version, filename, checksum_sha256)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
        initializeFreshDatabase = false;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure; client.end() runs in finally.
        }
        throw error;
      }

      console.log(`Applied: ${migration.filename}`);
    }

    console.log("Control database migrations are up to date.");
  } finally {
    if (connected) {
      if (lockHeld) {
        try {
          await client.query("SELECT pg_advisory_unlock($1, $2)", lockKeys);
        } catch {
          // Closing the connection releases session-level advisory locks.
        }
      }
      await client.end();
    }
  }
}

main().catch((error) => {
  // Do not log connection configuration or credentials.
  console.error(`Control migration failed: ${error.message}`);
  process.exitCode = 1;
});
