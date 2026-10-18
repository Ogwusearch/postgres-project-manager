BEGIN;

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    project_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE database_instances (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    environment TEXT NOT NULL
        CHECK (environment IN ('development', 'staging', 'production')),
    database_name TEXT NOT NULL UNIQUE,
    server_key TEXT NOT NULL DEFAULT 'local-postgres',
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'provisioning', 'ready', 'failed', 'retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, environment)
);

CREATE TABLE migration_runs (
    id UUID PRIMARY KEY,
    database_instance_id UUID NOT NULL REFERENCES database_instances(id),
    migration_version TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error_summary TEXT
);

CREATE TABLE backup_runs (
    id UUID PRIMARY KEY,
    database_instance_id UUID NOT NULL REFERENCES database_instances(id),
    backup_location TEXT,
    checksum_sha256 TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    restore_tested_at TIMESTAMPTZ
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    outcome TEXT NOT NULL
        CHECK (outcome IN ('succeeded', 'failed')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_database_instances_project
    ON database_instances(project_id);

CREATE INDEX idx_migration_runs_instance
    ON migration_runs(database_instance_id, started_at DESC);

CREATE INDEX idx_backup_runs_instance
    ON backup_runs(database_instance_id, started_at DESC);

CREATE INDEX idx_audit_events_created
    ON audit_events(created_at DESC);

COMMIT;
