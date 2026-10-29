import { useEffect, useState } from "react";
import type { Role, Session } from "../../../app/app-types";

export type OperationsPageName =
  | "Migrations"
  | "Backups"
  | "Monitoring"
  | "Audit log"
  | "Users & access"
  | "Settings";

export interface OperationsWorkspace {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
}

interface OperationsPageProps {
  page: OperationsPageName;
  tenantId: string;
  workspace?: OperationsWorkspace;
  session: Session;
  onSessionExpired: () => void;
}

type MigrationRun = {
  id: string;
  database_instance_id: string;
  database_name: string;
  environment: string;
  project_key: string;
  project_name: string;
  migration_version: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
};

type BackupRun = {
  id: string;
  database_instance_id: string;
  database_name: string;
  environment: string;
  project_key: string;
  project_name: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  restore_tested_at: string | null;
  checksum_sha256: string | null;
  location_recorded: boolean;
};

type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  outcome: "succeeded" | "failed";
  details: Record<string, unknown>;
  created_at: string;
};

type WorkspaceUser = {
  id: string;
  email: string;
  status: "active" | "disabled";
  is_super_admin: boolean;
  role: "admin" | "database_operator" | "viewer";
  assigned_project_count: number | string;
};

type MonitoringData = {
  checked_at: string;
  control_database: "connected";
  target_connections: "not_probed";
  total_instances: number;
  instances_by_status: Record<string, number>;
};

type SettingsData = {
  account: {
    id: string;
    email: string;
    is_super_admin: boolean;
    status: "active" | "disabled";
  };
  workspace: {
    tenant_id: string;
    tenant_key: string;
    tenant_name: string;
    tenant_status: "active";
    role: Role;
  };
  editable_settings_available: false;
};

type ApiBody<T> = { data?: T; error?: string };

type OperationsPayload =
  | { kind: "migrations"; rows: MigrationRun[] }
  | { kind: "backups"; rows: BackupRun[] }
  | { kind: "monitoring"; summary: MonitoringData }
  | { kind: "audit"; rows: AuditEvent[] }
  | { kind: "users"; rows: WorkspaceUser[] }
  | { kind: "settings"; settings: SettingsData };

const endpoints: Partial<Record<OperationsPageName, string>> = {
  Migrations: "/api/migration-runs?limit=100&offset=0",
  Backups: "/api/backup-runs?limit=100&offset=0",
  Monitoring: "/api/monitoring",
  "Audit log": "/api/audit-events?limit=100&offset=0",
  "Users & access": "/api/users?limit=100&offset=0",
  Settings: "/api/settings",
};

const roleLabels: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Tenant Admin",
  database_operator: "Database Operator",
  viewer: "Viewer",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function StatusPill({ value }: { value: string }) {
  const kind = value === "ready" || value === "succeeded" || value === "active" || value === "connected"
    ? "success"
    : value === "failed" || value === "disabled"
      ? "warning"
      : "neutral";
  const label = value.replaceAll("_", " ");
  return <span className={`status status-${kind}`}><span className="status-dot" />{label}</span>;
}

function Metric({ label, value, description }: { label: string; value: string | number; description?: string }) {
  return <article className="metric-card operation-metric"><div className="metric-top"><span>{label}</span></div><div className="metric-value">{value}</div>{description && <div className="metric-foot"><span className="metric-muted">{description}</span></div>}</article>;
}

function EmptyRow({ columns, children }: { columns: number; children: React.ReactNode }) {
  return <tr><td className="empty-state" colSpan={columns}>{children}</td></tr>;
}

export default function OperationsPage({
  page,
  tenantId,
  workspace,
  session,
  onSessionExpired,
}: OperationsPageProps) {
  const [loadState, setLoadState] = useState<
    | {
        requestKey: string;
        status: "success";
        payload: OperationsPayload;
      }
    | {
        requestKey: string;
        status: "error";
        error: string;
      }
    | null
  >(null);
  const [refreshNumber, setRefreshNumber] = useState(0);

  const endpoint = endpoints[page];
  const requestKey = JSON.stringify([page, tenantId, refreshNumber]);

  // A result belongs only to the page, tenant and refresh that requested it.
  const activeLoadState =
    loadState?.requestKey === requestKey ? loadState : null;

  const loading = Boolean(
    endpoint && tenantId && activeLoadState === null
  );

  const error = !endpoint
    ? ""
    : !tenantId
      ? "Select an active workspace before loading operations data."
      : activeLoadState?.status === "error"
        ? activeLoadState.error
        : "";

  const payload =
    activeLoadState?.status === "success"
      ? activeLoadState.payload
      : null;

  useEffect(() => {
    if (!endpoint || !tenantId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
          headers: { "X-Tenant-Id": tenantId },
        });

        if (cancelled) return;

        if (response.status === 401) {
          setLoadState({
            requestKey,
            status: "error",
            error: "Your session has expired. Please sign in again.",
          });
          onSessionExpired();
          return;
        }

        const body = await response.json().catch(() => ({})) as ApiBody<unknown>;

        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : `Request failed (${response.status}).`
          );
        }

        if (cancelled) return;

        let nextPayload: OperationsPayload | null = null;

        if (page === "Migrations") {
          nextPayload = {
            kind: "migrations",
            rows: (body.data ?? []) as MigrationRun[],
          };
        } else if (page === "Backups") {
          nextPayload = {
            kind: "backups",
            rows: (body.data ?? []) as BackupRun[],
          };
        } else if (page === "Monitoring") {
          nextPayload = {
            kind: "monitoring",
            summary: body.data as MonitoringData,
          };
        } else if (page === "Audit log") {
          nextPayload = {
            kind: "audit",
            rows: (body.data ?? []) as AuditEvent[],
          };
        } else if (page === "Users & access") {
          nextPayload = {
            kind: "users",
            rows: (body.data ?? []) as WorkspaceUser[],
          };
        } else if (page === "Settings") {
          nextPayload = {
            kind: "settings",
            settings: body.data as SettingsData,
          };
        }

        if (!nextPayload) {
          throw new Error("No data handler is configured for this page.");
        }

        setLoadState({
          requestKey,
          status: "success",
          payload: nextPayload,
        });
      } catch (caught) {
        if (!cancelled) {
          setLoadState({
            requestKey,
            status: "error",
            error: caught instanceof Error
              ? caught.message
              : "Unable to load operations data.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [endpoint, onSessionExpired, page, requestKey, tenantId]);

  const pageSubtitle: Record<OperationsPageName, string> = {
    Migrations: "Migration history recorded by the control plane for this workspace.",
    Backups: "Backup history and restore-test timestamps recorded by the control plane.",
    Monitoring: "Current control-plane readiness and registered database lifecycle status.",
    "Audit log": "Recent audit events for projects and database instances you can access.",
    "Users & access": "Workspace memberships and project-assignment counts. This view is read-only.",
    Settings: "Your authenticated account and the currently selected workspace.",
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / {page.toUpperCase()}</p>
          <h1>{page}</h1>
          <p className="subtitle">{pageSubtitle[page]}</p>
        </div>
        {endpoint && (
          <button className="secondary-button" type="button" onClick={() => setRefreshNumber((value) => value + 1)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh data"}
          </button>
        )}
      </section>

      {error && <div className="operation-error" role="alert"><strong>Unable to load {page.toLowerCase()}</strong><p>{error}</p>{(page === "Audit log" || page === "Migrations" || page === "Backups") && <small>The runtime role needs the approved operations-read permissions migration before it can read this history.</small>}</div>}
      {loading && <section className="panel operation-state" role="status">Loading real {page.toLowerCase()} data…</section>}

      {!loading && !error && payload?.kind === "migrations" && (
        <>
          <div className="operation-notice"><strong>Read-only migration history</strong><span>Migration execution is not exposed by the current API. No migration actions are simulated here.</span></div>
          <section className="panel">
            <div className="panel-heading"><div><h2>Migration runs</h2><p>Real records from the control database</p></div><span className="result-count">{payload.rows.length} records</span></div>
            <div className="table-scroll"><table><thead><tr><th>PROJECT</th><th>DATABASE</th><th>VERSION</th><th>STATUS</th><th>STARTED</th><th>FINISHED</th></tr></thead><tbody>
              {payload.rows.map((row) => <tr key={row.id}><td><strong>{row.project_name}</strong><small className="operation-secondary">{row.project_key}</small></td><td>{row.database_name}<small className="operation-secondary">{row.environment}</small></td><td>{row.migration_version}</td><td><StatusPill value={row.status} /></td><td>{formatDate(row.started_at)}</td><td>{formatDate(row.finished_at)}</td></tr>)}
              {payload.rows.length === 0 && <EmptyRow columns={6}>No migration runs have been recorded for this workspace.</EmptyRow>}
            </tbody></table></div>
          </section>
        </>
      )}

      {!loading && !error && payload?.kind === "backups" && (
        <>
          <div className="operation-notice"><strong>Read-only backup history</strong><span>Backup creation and restore execution are not available in the current API. This page only reports recorded runs.</span></div>
          <section className="panel">
            <div className="panel-heading"><div><h2>Backup runs</h2><p>Recorded backup outcomes and restore-test timestamps</p></div><span className="result-count">{payload.rows.length} records</span></div>
            <div className="table-scroll"><table><thead><tr><th>PROJECT / DATABASE</th><th>STATUS</th><th>STARTED</th><th>FINISHED</th><th>RESTORE TEST</th><th>LOCATION</th><th>CHECKSUM</th></tr></thead><tbody>
              {payload.rows.map((row) => <tr key={row.id}><td><strong>{row.project_name}</strong><small className="operation-secondary">{row.project_key} · {row.database_name}</small></td><td><StatusPill value={row.status} /></td><td>{formatDate(row.started_at)}</td><td>{formatDate(row.finished_at)}</td><td>{formatDate(row.restore_tested_at)}</td><td>{row.location_recorded ? "Recorded" : "Not recorded"}</td><td>{row.checksum_sha256 ? <code>{row.checksum_sha256.slice(0, 12)}…</code> : "—"}</td></tr>)}
              {payload.rows.length === 0 && <EmptyRow columns={7}>No backup runs have been recorded for this workspace.</EmptyRow>}
            </tbody></table></div>
          </section>
        </>
      )}

      {!loading && !error && payload?.kind === "monitoring" && (
        <>
          <div className="metric-grid operation-monitoring-grid">
            <Metric label="Control database" value="Connected" description={`Checked ${formatDate(payload.summary.checked_at)}`} />
            <Metric label="Registered instances" value={payload.summary.total_instances} description="Visible in the selected workspace" />
            <Metric label="Ready" value={payload.summary.instances_by_status.ready ?? 0} description="Registry status is ready" />
            <Metric label="Needs attention" value={(payload.summary.instances_by_status.failed ?? 0) + (payload.summary.instances_by_status.provisioning ?? 0)} description="Failed or still provisioning" />
          </div>
          <section className="panel">
            <div className="panel-heading"><div><h2>Database instance status</h2><p>Counts from the tenant-scoped registry</p></div></div>
            <div className="operation-status-list">
              {Object.entries(payload.summary.instances_by_status).map(([status, count]) => <div className="operation-status-row" key={status}><span><StatusPill value={status} /></span><strong>{count}</strong></div>)}
            </div>
          </section>
          <div className="operation-notice"><strong>Monitoring scope</strong><span>The control database health is checked by this API request. Target database connections are not probed continuously; run Verify connection on the Databases page for an explicit check.</span></div>
        </>
      )}

      {!loading && !error && payload?.kind === "audit" && (
        <section className="panel">
          <div className="panel-heading"><div><h2>Audit events</h2><p>Events scoped to this tenant’s accessible project and database targets</p></div><span className="result-count">{payload.rows.length} records</span></div>
          <div className="table-scroll"><table><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>TARGET</th><th>OUTCOME</th><th>DETAILS</th></tr></thead><tbody>
            {payload.rows.map((event) => <tr key={event.id}><td>{formatDate(event.created_at)}</td><td><code>{event.actor}</code></td><td>{event.action}</td><td>{event.target}</td><td><StatusPill value={event.outcome} /></td><td><details><summary>View details</summary><pre className="operation-json">{JSON.stringify(event.details, null, 2)}</pre></details></td></tr>)}
            {payload.rows.length === 0 && <EmptyRow columns={6}>No audit events are recorded for the projects and database instances visible in this workspace.</EmptyRow>}
          </tbody></table></div>
        </section>
      )}

      {!loading && !error && payload?.kind === "users" && (
        <>
          <div className="operation-notice"><strong>Workspace access directory</strong><span>Role changes, invitations, and project assignment editing are not implemented yet. This page does not modify access.</span></div>
          {payload.rows.length === 0 && (
            <div className="operation-notice">
              <strong>Why no members are listed</strong>
              <span>Platform Super Admin privileges are separate from workspace membership. This directory lists recorded memberships for the selected workspace. A Super Admin without a membership can still administer the platform. No memberships or permissions have been changed.</span>
            </div>
          )}
          <section className="panel">
            <div className="panel-heading"><div><h2>Members and roles</h2><p>Memberships for {workspace?.tenant_name ?? "the selected workspace"}</p></div><span className="result-count">{payload.rows.length} users</span></div>
            <div className="table-scroll"><table><thead><tr><th>USER</th><th>ACCOUNT STATUS</th><th>WORKSPACE ROLE</th><th>PROJECT ACCESS</th></tr></thead><tbody>
              {payload.rows.map((user) => <tr key={user.id}><td><strong>{user.email}</strong><small className="operation-secondary">{user.is_super_admin ? "Platform Super Admin" : "Workspace member"}</small></td><td><StatusPill value={user.status} /></td><td>{roleLabels[user.role as Role] ?? user.role}</td><td>{Number(user.assigned_project_count)}</td></tr>)}
              {payload.rows.length === 0 && <EmptyRow columns={4}>No users have workspace memberships recorded for this tenant.</EmptyRow>}
            </tbody></table></div>
          </section>
        </>
      )}

      {!loading && !error && payload?.kind === "settings" && (
        <>
          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Signed-in account</h2><p>Account details resolved by the authenticated API</p></div><StatusPill value={payload.settings.account.status} /></div>
            <dl className="operation-details">
              <div><dt>Email</dt><dd>{payload.settings.account.email}</dd></div>
              <div><dt>Platform access</dt><dd>{payload.settings.account.is_super_admin ? "Super Admin" : "Workspace member"}</dd></div>
              <div><dt>Effective role</dt><dd>{roleLabels[payload.settings.workspace.role] ?? payload.settings.workspace.role}</dd></div>
              <div><dt>User ID</dt><dd><code>{payload.settings.account.id}</code></dd></div>
              <div><dt>Authentication</dt><dd>Cookie-backed session; state-changing requests require CSRF validation.</dd></div>
            </dl>
          </section>
          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Selected workspace</h2><p>Server-resolved tenant context used by workspace requests</p></div><StatusPill value={payload.settings.workspace.tenant_status} /></div>
            <dl className="operation-details">
              <div><dt>Name</dt><dd>{payload.settings.workspace.tenant_name}</dd></div>
              <div><dt>Key</dt><dd><code>{payload.settings.workspace.tenant_key}</code></dd></div>
              <div><dt>Tenant ID</dt><dd><code>{payload.settings.workspace.tenant_id}</code></dd></div>
            </dl>
          </section>
          <div className="operation-notice"><strong>Editable settings are not connected</strong><span>The API returns the verified account and workspace context only. Persistent preferences, password changes, and tenant setting updates are not implemented and are not simulated here.</span></div>
        </>
      )}
      <footer className="page-footer"><span>pgcontrol <span>·</span> Operations workspace</span><span><i className="status-dot" /> Signed in as {session.email}</span></footer>
    </>
  );
}
