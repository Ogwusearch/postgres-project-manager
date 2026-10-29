import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiDatabaseInstance, ApiProject } from "../../../app/app-types";

interface DiscoveryColumn {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  udtName: string;
  nullable: boolean;
}

interface DiscoveryTable {
  schemaName: string;
  tableName: string;
  tableType: string;
  columns: DiscoveryColumn[];
}

interface DiscoveryData {
  ok: true;
  databaseName: string;
  discoveredAt: string;
  schemas: string[];
  tables: DiscoveryTable[];
}

interface DiscoveryResponseBody {
  data?: DiscoveryData;
  error?: string;
  code?: string;
}

interface VerificationResponseBody {
  data?: {
    ok: boolean;
    code: string;
    message: string;
    lifecycleStatus: string;
  };
  error?: string;
}

interface DatabaseExplorerProps {
  tenantId: string;
  instances: ApiDatabaseInstance[];
  projects: ApiProject[];
  canVerify: boolean;
  onSessionExpired: () => void;
  onInstanceStatusChange: (
    instanceId: string,
    status: ApiDatabaseInstance["status"],
  ) => void;
}

function readApiErrorBody(body: DiscoveryResponseBody, status: number): string {
  return typeof body.error === "string"
    ? body.error
    : `Request failed (${status}).`;
}

function readCsrfCookie(): string | null {
  const entry = document.cookie
    .split("; ")
    .find((item) => item.startsWith("ppm_csrf="));
  if (!entry) return null;

  try {
    return decodeURIComponent(entry.slice("ppm_csrf=".length));
  } catch {
    return null;
  }
}

function isDatabaseStatus(value: string): value is ApiDatabaseInstance["status"] {
  return ["planned", "provisioning", "ready", "failed", "retired"].includes(value);
}

function tableKey(table: Pick<DiscoveryTable, "schemaName" | "tableName">): string {
  return JSON.stringify([table.schemaName, table.tableName]);
}

export default function DatabaseExplorer({
  tenantId,
  instances,
  projects,
  canVerify,
  onSessionExpired,
  onInstanceStatusChange,
}: DatabaseExplorerProps) {
  const [discovery, setDiscovery] = useState<DiscoveryData | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [selectedSchema, setSelectedSchema] = useState("");
  const [selectedTableKey, setSelectedTableKey] = useState("");
  const [discoveryBusyId, setDiscoveryBusyId] = useState("");
  const [verificationBusyId, setVerificationBusyId] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const discoverySequence = useRef(0);
  const verificationSequence = useRef(0);

  // The parent keys this component by tenant ID. Incrementing these sequence
  // values on unmount ensures late responses from the previous tenant are ignored.
  useEffect(() => () => {
    discoverySequence.current += 1;
    verificationSequence.current += 1;
  }, []);

  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId);
  const selectedSchemaTables = useMemo(
    () => discovery?.tables.filter((table) => table.schemaName === selectedSchema) ?? [],
    [discovery, selectedSchema],
  );
  const selectedTable = selectedSchemaTables.find(
    (table) => tableKey(table) === selectedTableKey,
  ) ?? selectedSchemaTables[0];

  async function discover(instance: ApiDatabaseInstance) {
    const requestTenantId = tenantId;
    const sequence = ++discoverySequence.current;
    setSelectedInstanceId(instance.id);
    setDiscovery(null);
    setSelectedSchema("");
    setSelectedTableKey("");
    setDiscoveryError("");
    setOperationError("");
    setOperationNotice("");
    setDiscoveryBusyId(instance.id);

    try {
      const response = await fetch(
        `/api/database-instances/${encodeURIComponent(instance.id)}/discovery`,
        {
          credentials: "include",
          headers: { "X-Tenant-Id": requestTenantId },
        },
      );

      if (discoverySequence.current !== sequence) return;
      if (response.status === 401) {
        onSessionExpired();
        return;
      }

      const body = await response.json().catch(() => ({})) as DiscoveryResponseBody;
      if (!response.ok) {
        throw new Error(readApiErrorBody(body, response.status));
      }
      if (!body.data || body.data.databaseName !== instance.database_name) {
        throw new Error("The discovery response did not match the selected database instance.");
      }

      setDiscovery(body.data);
      const firstSchema = body.data.schemas[0] ?? body.data.tables[0]?.schemaName ?? "";
      setSelectedSchema(firstSchema);
      const firstTable = body.data.tables.find((table) => table.schemaName === firstSchema);
      setSelectedTableKey(firstTable ? tableKey(firstTable) : "");
    } catch (error) {
      if (discoverySequence.current === sequence) {
        setDiscoveryError(error instanceof Error ? error.message : "Database discovery failed.");
      }
    } finally {
      if (discoverySequence.current === sequence) {
        setDiscoveryBusyId("");
      }
    }
  }

  async function verify(instance: ApiDatabaseInstance) {
    const requestTenantId = tenantId;
    const csrfToken = readCsrfCookie();
    setSelectedInstanceId(instance.id);
    setOperationError("");
    setOperationNotice("");
    setDiscoveryError("");
    setDiscovery(null);

    if (!csrfToken) {
      setOperationError("The security token is missing. Refresh the dashboard and try again.");
      return;
    }

    const sequence = ++verificationSequence.current;
    discoverySequence.current += 1;
    setDiscoveryBusyId("");
    setVerificationBusyId(instance.id);
    try {
      const response = await fetch(
        `/api/database-instances/${encodeURIComponent(instance.id)}/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "X-Tenant-Id": requestTenantId,
            "X-CSRF-Token": csrfToken,
          },
        },
      );
      if (verificationSequence.current !== sequence) return;
      if (response.status === 401) {
        onSessionExpired();
        return;
      }

      const body = await response.json().catch(() => ({})) as VerificationResponseBody;
      const nextStatus = body.data?.lifecycleStatus;
      if (nextStatus && isDatabaseStatus(nextStatus)) {
        onInstanceStatusChange(instance.id, nextStatus);
      }

      if (!response.ok || body.data?.ok !== true) {
        throw new Error(body.data?.message || body.error || `Verification failed (${response.status}).`);
      }
      setOperationNotice(`${instance.database_name} verified successfully. Status: ${nextStatus ?? "ready"}.`);
    } catch (error) {
      if (verificationSequence.current === sequence) {
        setOperationError(error instanceof Error ? error.message : "Database verification failed.");
      }
    } finally {
      if (verificationSequence.current === sequence) {
        setVerificationBusyId("");
      }
    }
  }

  return (
    <section className="database-explorer-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / DATABASES</p>
          <h1>Database Explorer</h1>
          <p className="subtitle">Verify registered connections and inspect real PostgreSQL schema metadata.</p>
        </div>
      </header>

      {operationNotice && <p className="explorer-notice" role="status">{operationNotice}</p>}
      {operationError && <p className="auth-error" role="alert">{operationError}</p>}

      <section className="panel instances-panel">
        <div className="panel-heading">
          <div><h2>Registered instances</h2><p>Discovery is available only after a connection is verified and ready.</p></div>
        </div>
        {instances.length === 0 ? (
          <p className="empty-state">No database instances are registered for this workspace.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>DATABASE</th><th>PROJECT</th><th>ENVIRONMENT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
              <tbody>
                {instances.map((instance) => {
                  const project = projects.find((candidate) => candidate.id === instance.project_id);
                  const isVerifying = verificationBusyId === instance.id;
                  const isDiscovering = discoveryBusyId === instance.id;
                  return (
                    <tr key={instance.id}>
                      <td><strong>{instance.database_name}</strong><small className="explorer-secondary">{instance.server_key}</small></td>
                      <td>{project?.name ?? project?.project_key ?? "Unknown project"}</td>
                      <td>{instance.environment}</td>
                      <td><span className={`status status-${instance.status === "ready" ? "success" : instance.status === "failed" ? "warning" : "neutral"}`}>{instance.status.replaceAll("_", " ")}</span></td>
                      <td>
                        <div className="explorer-actions">
                          {canVerify && instance.status !== "retired" && (
                            <button
                              type="button"
                              className="secondary-button explorer-action-button"
                              disabled={isVerifying || isDiscovering}
                              onClick={() => void verify(instance)}
                            >
                              {isVerifying ? "Verifying…" : "Verify connection"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="primary-button explorer-action-button"
                            disabled={instance.status !== "ready" || isVerifying || isDiscovering}
                            onClick={() => void discover(instance)}
                            title={instance.status !== "ready" ? "Verify this instance before discovery" : undefined}
                          >
                            {isDiscovering ? "Discovering…" : discovery && selectedInstanceId === instance.id ? "Refresh discovery" : "Discover schema"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {discoveryError && <p className="auth-error" role="alert">{discoveryError}</p>}

      {discovery && selectedInstance && selectedInstance.id === selectedInstanceId && (
        <section className="panel discovery-panel" aria-labelledby="discovery-heading">
          <div className="panel-heading discovery-panel-heading">
            <div>
              <p className="eyebrow">READ-ONLY METADATA</p>
              <h2 id="discovery-heading">{discovery.databaseName}</h2>
              <p>Discovered {new Date(discovery.discoveredAt).toLocaleString()} · {discovery.schemas.length} schemas · {discovery.tables.length} tables/views</p>
            </div>
          </div>

          {discovery.schemas.length === 0 ? (
            <p className="empty-state">No application schemas were found.</p>
          ) : (
            <div className="discovery-layout">
              <aside className="schema-list" aria-label="Database schemas">
                <h3>Schemas</h3>
                {discovery.schemas.map((schema) => (
                  <button
                    type="button"
                    key={schema}
                    className={`schema-button ${selectedSchema === schema ? "active" : ""}`}
                    aria-pressed={selectedSchema === schema}
                    onClick={() => {
                      setSelectedSchema(schema);
                      const firstTable = discovery.tables.find((table) => table.schemaName === schema);
                      setSelectedTableKey(firstTable ? tableKey(firstTable) : "");
                    }}
                  >
                    <span>{schema}</span>
                    <small>{discovery.tables.filter((table) => table.schemaName === schema).length}</small>
                  </button>
                ))}
              </aside>

              <div className="discovery-table-list">
                <h3>Tables and views</h3>
                {selectedSchemaTables.length === 0 ? (
                  <p className="empty-state">No tables or views in this schema.</p>
                ) : (
                  <div className="table-name-list">
                    {selectedSchemaTables.map((table) => (
                      <button
                        type="button"
                        key={tableKey(table)}
                        className={`table-name-button ${selectedTable && tableKey(selectedTable) === tableKey(table) ? "active" : ""}`}
                        aria-pressed={Boolean(selectedTable && tableKey(selectedTable) === tableKey(table))}
                        onClick={() => setSelectedTableKey(tableKey(table))}
                      >
                        <span>{table.tableName}</span>
                        <small>{table.tableType === "VIEW" ? "View" : table.tableType === "FOREIGN" ? "Foreign table" : "Table"}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="column-detail">
                <h3>{selectedTable ? `${selectedTable.schemaName}.${selectedTable.tableName}` : "Column metadata"}</h3>
                {selectedTable ? (
                  <>
                    <p className="explorer-secondary">{selectedTable.tableType} · {selectedTable.columns.length} columns</p>
                    {selectedTable.columns.length === 0 ? (
                      <p className="empty-state">No column metadata was returned.</p>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead><tr><th>#</th><th>COLUMN</th><th>DATA TYPE</th><th>NULLABLE</th></tr></thead>
                          <tbody>
                            {selectedTable.columns.map((column) => (
                              <tr key={`${column.ordinalPosition}-${column.columnName}`}>
                                <td>{column.ordinalPosition}</td>
                                <td><strong>{column.columnName}</strong></td>
                                <td><span title={column.udtName}>{column.dataType}</span></td>
                                <td>{column.nullable ? "Yes" : "No"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="empty-state">Select a table or view to inspect its columns.</p>
                )}
              </div>
            </div>
          )}
          <div className="panel-footer"><span>Metadata only · Source rows were not read or changed</span><span>{discovery.databaseName}</span></div>
        </section>
      )}
    </section>
  );
}
