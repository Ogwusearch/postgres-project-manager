import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import "./App.css";

const API_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

type Project = {
  id: string;
  project_key: string;
  name: string;
  status: "active" | "inactive" | "archived";
  created_at: string;
};
type Environment = "development" | "staging" | "production";
type InstanceStatus = "planned" | "provisioning" | "ready" | "failed" | "retired";
type Instance = {
  id: string;
  project_id: string;
  environment: Environment;
  database_name: string;
  server_key: string;
  status: InstanceStatus;
  created_at: string;
};
type Health = { status: string; database: string };
type Verification = { ok: boolean; message: string; code: string; durationMs: number; lifecycleStatus: string };
type View = "Overview" | "Projects" | "Database instances" | "Verification";
type ApiBody<T> = { data?: T; error?: string; message?: string; [key: string]: unknown };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new Error("Cannot reach the API. Check that the backend is running and the API URL is correct.");
  }
  const body = (await response.json().catch(() => ({}))) as ApiBody<T>;
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
    folder: "M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    shield: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z M9 12l2 2 4-4",
    refresh: "M20 7v5h-5 M4 17v-5h5 M5.6 9a7 7 0 0 1 11.6-2L20 12 M4 12l2.8 5a7 7 0 0 0 11.6-2",
    plus: "M12 5v14 M5 12h14",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
    arrow: "M7 17 17 7 M7 7h10v10",
    check: "m5 12 4 4L19 6",
    warning: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18.1A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z",
    close: "M18 6 6 18 M6 6l12 12",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="icon"><path d={paths[name] || paths.grid} /></svg>;
}

function Status({ value }: { value: string }) {
  const tone = ["ready", "active", "connected", "succeeded"].includes(value)
    ? "success"
    : ["failed", "archived", "unavailable", "error"].includes(value)
      ? "danger"
      : value === "production" ? "production" : ["provisioning", "staging"].includes(value) ? "warning" : "neutral";
  return <span className={`status status-${tone}`}><span className="status-dot" />{value.replaceAll("_", " ")}</span>;
}
function shortId(id: string) { return id ? `${id.slice(0, 8)}…` : "—"; }
function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function App() {
  const [view, setView] = useState<View>("Overview");
  const [projects, setProjects] = useState<Project[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [verification, setVerification] = useState<Record<string, Verification>>({});
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showInstanceForm, setShowInstanceForm] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [provisioningId, setProvisioningId] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [instanceProjectId, setInstanceProjectId] = useState("");
  const [instanceEnvironment, setInstanceEnvironment] = useState<Environment>("development");
  const [databaseName, setDatabaseName] = useState("");
  const [serverKey, setServerKey] = useState("local-postgres");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    const [healthResult, projectResult, instanceResult] = await Promise.allSettled([
      request<Health>("/health"),
      request<{ data: Project[] }>("/api/projects?limit=100&offset=0"),
      request<{ data: Instance[] }>("/api/database-instances"),
    ]);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else setHealth(null);
    if (projectResult.status === "fulfilled") setProjects(projectResult.value.data || []);
    if (instanceResult.status === "fulfilled") setInstances(instanceResult.value.data || []);
    const failures = [healthResult, projectResult, instanceResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : "A request failed.");
    if (failures.length) setError(failures.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) void loadData();
    });

    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const visibleProjects = useMemo(() => {
    const query = search.toLowerCase().trim();
    return projects.filter((project) => !query || project.name.toLowerCase().includes(query) || project.project_key.toLowerCase().includes(query));
  }, [projects, search]);
  const visibleInstances = useMemo(() => {
    const query = search.toLowerCase().trim();
    return instances.filter((instance) => {
      const projectName = projectById.get(instance.project_id)?.name || "";
      return !query || [instance.database_name, instance.server_key, instance.environment, instance.status, projectName]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [instances, projectById, search]);
  const readyCount = instances.filter((instance) => instance.status === "ready").length;
  const failedCount = instances.filter((instance) => instance.status === "failed").length;

  function showNotice(message: string, isError = false) { setNotice(message); setNoticeError(isError); }
  function changeView(next: View) { setView(next); setSearch(""); setMobileNavOpen(false); }

  async function verifyInstance(instance: Instance) {
    setBusyId(instance.id); setNotice("");
    try {
      const body = await request<{ data?: Verification }>(`/api/database-instances/${instance.id}/verify`, { method: "POST" });
      if (body.data) setVerification((previous) => ({ ...previous, [instance.id]: body.data! }));
      showNotice(`Verification completed for ${instance.database_name}.`);
      await loadData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Verification request failed.", true);
    } finally { setBusyId(""); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreatingProject(true); setNotice("");
    try {
      await request("/api/projects", { method: "POST", body: JSON.stringify({ project_key: projectKey.trim(), name: projectName.trim(), status: "active" }) });
      setProjectKey(""); setProjectName(""); setShowProjectForm(false); changeView("Projects");
      showNotice("Project registered successfully."); await loadData(true);
    } catch (err) { showNotice(err instanceof Error ? err.message : "Could not create project.", true); }
    finally { setCreatingProject(false); }
  }

  async function createInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreatingInstance(true); setNotice("");
    try {
      // The backend scopes instance registration to the project in the URL.
      await request(`/api/projects/${encodeURIComponent(instanceProjectId)}/database-instances`, {
        method: "POST",
        body: JSON.stringify({
          environment: instanceEnvironment,
          database_name: databaseName.trim(),
          server_key: serverKey.trim(),
        }),
      });
      setDatabaseName(""); setInstanceProjectId(""); setInstanceEnvironment("development"); setServerKey("local-postgres");
      setShowInstanceForm(false); changeView("Database instances");
      showNotice("Database instance registered successfully."); await loadData(true);
    } catch (err) { showNotice(err instanceof Error ? err.message : "Could not register database instance.", true); }
    finally { setCreatingInstance(false); }
  }

  async function provisionInstance(instance: Instance) {
    if (instance.environment !== "development") {
      showNotice("Provisioning is currently restricted to development instances.", true); return;
    }
    const confirmed = window.confirm(`Provision database "${instance.database_name}" for the ${instance.environment} environment? This will ask the backend to create the database if it does not already exist.`);
    if (!confirmed) return;
    setProvisioningId(instance.id); setNotice("");
    try {
      await request(`/api/database-instances/${instance.id}/provision`, { method: "POST" });
      showNotice(`Provisioning request completed for ${instance.database_name}.`);
      await loadData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Provisioning request failed.", true);
      await loadData(true);
    } finally { setProvisioningId(""); }
  }

  const navItems: { label: View; icon: string }[] = [
    { label: "Overview", icon: "grid" }, { label: "Projects", icon: "folder" },
    { label: "Database instances", icon: "database" }, { label: "Verification", icon: "shield" },
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); changeView("Overview"); }}>
        <span className="brand-mark">P<span>.</span></span><span className="brand-copy"><strong>PG CONTROL</strong><small>PROJECT MANAGER</small></span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-switch"><span className="workspace-avatar">P</span><span><strong>Platform control</strong><small>Default environment</small></span><span className="switch-chevron">⌄</span></div>
      <div className="nav-label">MANAGEMENT</div>
      <nav className="main-nav" aria-label="Main navigation">{navItems.map((item) => <button key={item.label} className={`nav-item ${view === item.label ? "active" : ""}`} onClick={() => changeView(item.label)}><Icon name={item.icon} /><span>{item.label}</span>{item.label === "Database instances" && instances.length > 0 && <span className="nav-count">{instances.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection-card"><span className={`connection-indicator ${health ? "online" : "offline"}`} /><div><strong>{health ? "API reachable" : "API disconnected"}</strong><small>{health?.database || "Check connection"}</small></div></div><div className="sidebar-footer"><span className="footer-symbol">⌘</span><span><strong>PG Control</strong><small>Management console</small></span><span className="version">v1.1</span></div></div>
    </aside>

    {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <main className="main-panel">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" aria-label="Toggle navigation" onClick={() => setMobileNavOpen((open) => !open)}><span /><span /><span /></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{view}</strong></div></div><div className="topbar-actions"><span className={`api-pill ${health ? "is-online" : "is-offline"}`}><span className="status-dot" />{health ? "API connected" : "API offline"}</span><button className="icon-button" aria-label="Refresh data" title="Refresh data" onClick={() => void loadData()} disabled={loading}><Icon name="refresh" /></button><span className="user-avatar">OG</span></div></header>
      <div className="content">
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />DATABASE OPERATIONS</div><h1>{view === "Overview" ? "Control center" : view}</h1><p className="page-description">{view === "Overview" ? "A clear view of your registered projects and database environments." : view === "Projects" ? "Manage the projects registered with your platform." : view === "Verification" ? "Verify database connectivity and review the latest results." : "Register, provision, verify, and monitor database environments."}</p></div><div className="heading-actions"><span className="last-updated"><span className="live-dot" />API DATA</span><div className="heading-button-group"><button className="button button-secondary" onClick={() => { if (!projects.length) { changeView("Projects"); showNotice("Register a project before registering a database instance.", true); } else setShowInstanceForm(true); }}><Icon name="database" />Add instance</button><button className="button button-primary" onClick={() => setShowProjectForm(true)}><Icon name="plus" />New project</button></div></div></section>

        {error && <div className="alert alert-error" role="alert"><Icon name="warning" /><div><strong>Some platform data could not be loaded</strong><p>{error}</p><small>API base URL: {API_URL}</small></div><button className="button button-quiet" onClick={() => void loadData()}>Retry</button></div>}
        {notice && <div className={`alert ${noticeError ? "alert-error" : "alert-notice"}`} role="status"><Icon name={noticeError ? "warning" : "check"} /><p>{notice}</p><button className="dismiss" aria-label="Dismiss message" onClick={() => setNotice("")}><Icon name="close" /></button></div>}

        {showProjectForm && <section className="panel create-panel"><div className="panel-heading"><div><h2>Register a project</h2><p>Register a project in the platform registry.</p></div><button className="dismiss" onClick={() => setShowProjectForm(false)} aria-label="Close form"><Icon name="close" /></button></div><form className="project-form" onSubmit={createProject}><label>Project name<input required minLength={2} maxLength={120} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. SolarAudit" /></label><label>Project key<input required pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" maxLength={60} value={projectKey} onChange={(event) => setProjectKey(event.target.value)} placeholder="e.g. solar-audit" /><small>Letters, numbers, hyphens and underscores.</small></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowProjectForm(false)}>Cancel</button><button className="button button-primary" disabled={creatingProject}>{creatingProject ? "Registering…" : "Register project"}</button></div></form></section>}

        {showInstanceForm && <section className="panel create-panel"><div className="panel-heading"><div><h2>Register database instance</h2><p>Add an environment to a registered project. Registration does not create the database.</p></div><button className="dismiss" onClick={() => setShowInstanceForm(false)} aria-label="Close form"><Icon name="close" /></button></div><form className="project-form instance-form" onSubmit={createInstance}>
          <label>Project<select required value={instanceProjectId} onChange={(event) => setInstanceProjectId(event.target.value)}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} ({project.project_key})</option>)}</select></label>
          <label>Environment<select required value={instanceEnvironment} onChange={(event) => setInstanceEnvironment(event.target.value as Environment)}><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></label>
          <label>Database name<input required pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}" maxLength={63} value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="e.g. solar_audit_dev" /><small>Starts with a letter or underscore; max 63 characters.</small></label>
          <label>Trusted server key<input required maxLength={100} value={serverKey} onChange={(event) => setServerKey(event.target.value)} placeholder="local-postgres" /><small>Must match a server key configured by the backend.</small></label>
          <div className="form-hint"><Icon name="shield" /><span>Server credentials stay on the backend. Do not enter passwords here. Provisioning is currently enabled for development instances only.</span></div>
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowInstanceForm(false)}>Cancel</button><button className="button button-primary" disabled={creatingInstance || !projects.length}>{creatingInstance ? "Registering…" : "Register instance"}</button></div>
        </form></section>}

        {view === "Overview" && <><section className="metric-grid"><MetricCard icon="folder" tone="purple" label="REGISTERED PROJECTS" value={loading ? "—" : projects.length} foot="Projects in your registry" /><MetricCard icon="database" tone="blue" label="DATABASE INSTANCES" value={loading ? "—" : instances.length} foot="Across all environments" /><MetricCard icon="check" tone="green" label="READY" value={loading ? "—" : readyCount} foot="Ready lifecycle state" /><MetricCard icon="warning" tone="red" label="FAILED" value={loading ? "—" : failedCount} foot="Requires investigation" /></section>
          <section className="panel"><div className="panel-heading"><div><h2>Database instances</h2><p>Recent environments registered across your projects.</p></div><button className="button button-secondary" onClick={() => changeView("Database instances")}>View all <Icon name="arrow" /></button></div><InstanceTable instances={[...instances].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5)} projectById={projectById} loading={loading} busyId={busyId} provisioningId={provisioningId} onVerify={verifyInstance} onProvision={provisionInstance} verification={verification} /></section>
          <section className="panel"><div className="panel-heading"><div><h2>Registered projects</h2><p>Projects connected to this management workspace.</p></div><button className="button button-secondary" onClick={() => changeView("Projects")}>View all <Icon name="arrow" /></button></div><ProjectTable projects={projects.slice(0, 5)} loading={loading} /></section></>}

        {view === "Projects" && <section className="panel"><div className="panel-heading table-toolbar"><div><h2>Project registry</h2><p>{projects.length} registered project{projects.length === 1 ? "" : "s"}</p></div><label className="search-box"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" /></label></div><ProjectTable projects={visibleProjects} loading={loading} /></section>}
        {(view === "Database instances" || view === "Verification") && <section className="panel"><div className="panel-heading table-toolbar"><div><h2>{view === "Verification" ? "Connectivity checks" : "Instance registry"}</h2><p>{visibleInstances.length} instance{visibleInstances.length === 1 ? "" : "s"} found</p></div><label className="search-box"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search databases…" /></label></div><InstanceTable instances={visibleInstances} projectById={projectById} loading={loading} busyId={busyId} provisioningId={provisioningId} onVerify={verifyInstance} onProvision={provisionInstance} verification={verification} /></section>}
        <footer className="page-footer"><span><span className="footer-live" />POSTGRES PROJECT MANAGER</span><span>Data served by your configured API</span></footer>
      </div>
    </main>
  </div>;
}

function MetricCard({ icon, tone, label, value, foot }: { icon: string; tone: string; label: string; value: string | number; foot: string }) {
  return <article className="metric-card"><div className="metric-top"><span className={`metric-icon metric-${tone}`}><Icon name={icon} /></span><span className="metric-label">{label}</span></div><div className="metric-value">{value}</div><div className="metric-foot"><span className={`metric-foot-dot ${tone}-dot`} />{foot}</div></article>;
}
function ProjectTable({ projects, loading }: { projects: Project[]; loading: boolean }) {
  if (loading) return <div className="table-state"><span className="spinner" />Loading projects…</div>;
  if (!projects.length) return <div className="table-state"><span className="empty-icon"><Icon name="folder" /></span><strong>No projects found</strong><span>Register a project to get started.</span></div>;
  return <div className="table-scroll"><table><thead><tr><th>PROJECT</th><th>PROJECT KEY</th><th>STATUS</th><th>CREATED</th><th>IDENTIFIER</th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><div className="table-primary"><span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><strong>{project.name}</strong></div></td><td><code className="code-chip">{project.project_key}</code></td><td><Status value={project.status} /></td><td className="muted-cell">{formatDate(project.created_at)}</td><td><code className="id-code">{shortId(project.id)}</code></td></tr>)}</tbody></table></div>;
}
function InstanceTable({ instances, projectById, loading, busyId, provisioningId, onVerify, onProvision, verification = {} }: { instances: Instance[]; projectById: Map<string, Project>; loading: boolean; busyId: string; provisioningId: string; onVerify: (instance: Instance) => void; onProvision: (instance: Instance) => void; verification?: Record<string, Verification> }) {
  if (loading) return <div className="table-state"><span className="spinner" />Loading database instances…</div>;
  if (!instances.length) return <div className="table-state"><span className="empty-icon"><Icon name="database" /></span><strong>No database instances found</strong><span>Register an instance for a project to start managing its lifecycle.</span></div>;
  return <div className="table-scroll"><table><thead><tr><th>DATABASE</th><th>PROJECT</th><th>ENVIRONMENT</th><th>LIFECYCLE</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>{instances.map((instance) => {
    const result = verification[instance.id]; const project = projectById.get(instance.project_id); const isBusy = busyId === instance.id; const isProvisioning = provisioningId === instance.id;
    return <tr key={instance.id}><td><div className="table-primary"><span className="database-avatar"><Icon name="database" /></span><span><strong>{instance.database_name}</strong><small className="table-subline">{instance.server_key} · {shortId(instance.id)}</small></span></div>{result && <small className={`verification-note ${result.ok ? "note-success" : "note-danger"}`}>{result.ok ? `Last check passed${result.durationMs != null ? ` · ${result.durationMs} ms` : ""}` : result.code || "Last check failed"}</small>}</td><td>{project ? <span className="project-name-cell">{project.name}</span> : <code className="id-code">{shortId(instance.project_id)}</code>}</td><td><Status value={instance.environment} /></td><td><Status value={instance.status} /></td><td className="muted-cell">{formatDate(instance.created_at)}</td><td><div className="row-actions">{instance.status === "retired" ? <span className="muted-cell">Retired</span> : <><button className="button button-small button-secondary" disabled={isBusy || isProvisioning || !!busyId || !!provisioningId} onClick={() => void onVerify(instance)}>{isBusy ? <><span className="button-spinner" />Checking…</> : <><Icon name="refresh" />Verify</>}</button>{instance.environment === "development" && instance.status !== "ready" && <button className="button button-small button-primary" disabled={isBusy || isProvisioning || !!busyId || !!provisioningId || instance.status === "provisioning"} onClick={() => void onProvision(instance)}>{isProvisioning ? <><span className="button-spinner" />Provisioning…</> : <><Icon name="database" />Provision</>}</button>}</>}</div></td></tr>;
  })}</tbody></table></div>;
}
export default App;
