
import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Role = "super_admin" | "admin" | "database_operator" | "viewer";

type Membership = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  tenant_status: "active" | "suspended";
  role: "admin" | "database_operator" | "viewer";
};

type Session = {
  id: string;
  email: string;
  is_super_admin: boolean;
  memberships: Membership[];
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

function readCsrfCookie(): string | null {
  const cookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith("ppm_csrf="));

  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice("ppm_csrf=".length));
  } catch {
    return null;
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Use the generic fallback when the response is not JSON.
  }

  return `Request failed (${response.status}).`;
}


type Project = {
  name: string;
  key: string;
  environment: string;
  database: string;
  status: "Healthy" | "Warning" | "Offline";
  updated: string;
};

const projects: Project[] = [
  {
    name: "Ogwusearch Engineering",
    key: "OGW",
    environment: "Production",
    database: "ogwusearch_prod",
    status: "Healthy",
    updated: "2 minutes ago",
  },
  {
    name: "SolarAudit",
    key: "SOL",
    environment: "Development",
    database: "solar_audit_dev",
    status: "Healthy",
    updated: "18 minutes ago",
  },
  {
    name: "Resort Platform",
    key: "RST",
    environment: "Production",
    database: "resort_platform_prod",
    status: "Warning",
    updated: "34 minutes ago",
  },
];

const instances = [
  { name: "ogwusearch_prod", project: "Ogwusearch Engineering", env: "Production", status: "Connected", version: "PostgreSQL 16" },
  { name: "solar_audit_dev", project: "SolarAudit", env: "Development", status: "Connected", version: "PostgreSQL 16" },
  { name: "resort_platform_prod", project: "Resort Platform", env: "Production", status: "Attention", version: "PostgreSQL 15" },
];

const navigation = [
  { section: "WORKSPACE", items: [
    { label: "Overview", icon: "grid" },
    { label: "Projects", icon: "layers" },
    { label: "Databases", icon: "database" },
  ]},
  { section: "OPERATIONS", items: [
    { label: "Migrations", icon: "git" },
    { label: "Backups", icon: "archive" },
    { label: "Monitoring", icon: "activity" },
    { label: "Audit log", icon: "history" },
  ]},
  { section: "ADMINISTRATION", items: [
    { label: "Users & access", icon: "users" },
    { label: "Settings", icon: "settings" },
  ]},
];

const roleLabels: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Tenant Admin",
  database_operator: "Database Operator",
  viewer: "Viewer",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    git: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M18 17v-2a4 4 0 0 0-4-4H10a4 4 0 0 1-4-4" /></>,
    archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.9-2 3.4-2.2-.5a8 8 0 0 1-2 .9L13.8 23h-3.6l-.6-2.2a8 8 0 0 1-2-.9l-2.2.5-2-3.4 1.1-1.9a8 8 0 0 1 0-2.1l-1.1-1.9 2-3.4 2.2.5a8 8 0 0 1 2-.9L10.2 5h3.6l.6 2.2a8 8 0 0 1 2 .9l2.2-.5 2 3.4-1.1 1.9a8 8 0 0 1-.1 2.1Z" transform="translate(0 -2) scale(1 .95)" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

function Status({ value }: { value: string }) {
  const kind = value === "Healthy" || value === "Connected"
    ? "success"
    : value === "Warning" || value === "Attention"
      ? "warning"
      : "neutral";

  return <span className={`status status-${kind}`}><span className="status-dot" />{value}</span>;
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [authError, setAuthError] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [activePage, setActivePage] = useState("Overview");
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("All environments");

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (response.status === 401) {
          if (!cancelled) setAuthStatus("unauthenticated");
          return;
        }

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const body = await response.json() as { data: Session };
        if (cancelled) return;

        setSession(body.data);
        setSelectedTenantId(body.data.memberships[0]?.tenant_id ?? "");
        setAuthError("");
        setAuthStatus("authenticated");
      } catch {
        if (!cancelled) {
          setAuthError("Unable to verify your session. Please try signing in again.");
          setAuthStatus("error");
        }
      }
    }

    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  const selectedMembership = session?.memberships.find(
    (membership) => membership.tenant_id === selectedTenantId,
  );

  const role: Role = session?.is_super_admin
    ? "super_admin"
    : selectedMembership?.role ?? "viewer";

  const visibleProjects = useMemo(() => projects.filter((project) => {
    const matchesSearch = `${project.name} ${project.database}`.toLowerCase().includes(search.toLowerCase());
    const matchesEnvironment = environment === "All environments" || project.environment === environment;
    return matchesSearch && matchesEnvironment;
  }), [search, environment]);

  const canManage = role === "super_admin" || role === "admin";
  const isViewer = role === "viewer";

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const profileResponse = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (!profileResponse.ok) {
        throw new Error(
          profileResponse.status === 401
            ? "Sign-in succeeded, but the session could not be verified. Please try again."
            : await readApiError(profileResponse),
        );
      }

      const body = await profileResponse.json() as { data: Session };
      setSession(body.data);
      setSelectedTenantId(body.data.memberships[0]?.tenant_id ?? "");
      setLoginPassword("");
      setAuthStatus("authenticated");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to sign in.",
      );
      setAuthStatus("unauthenticated");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setAuthError("");

    try {
      const csrfToken = readCsrfCookie();
      if (!csrfToken) {
        throw new Error("The security token is missing. Refresh the page and try again.");
      }

      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setSession(null);
      setSelectedTenantId("");
      setLoginPassword("");
      setAuthStatus("unauthenticated");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    }
  }

  if (authStatus === "loading") {
    return (
      <main className="auth-screen">
        <section className="auth-card" aria-live="polite">
          <span className="brand-mark"><Icon name="database" size={23} /></span>
          <h1>pgcontrol</h1>
          <p>Checking your session…</p>
        </section>
      </main>
    );
  }

  if (authStatus !== "authenticated") {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={handleLogin}>
          <span className="brand-mark"><Icon name="database" size={23} /></span>
          <p className="eyebrow">DATABASE PLATFORM</p>
          <h1>Sign in to pgcontrol</h1>
          <p className="subtitle">Use your platform account to continue.</p>

          {authError && <p className="auth-error" role="alert">{authError}</p>}

          <label className="auth-field">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
            />
          </label>

          <label className="auth-field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
          </label>

          <button className="primary-button auth-submit" type="submit" disabled={loginBusy}>
            {loginBusy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Session unavailable</h1>
          <p className="subtitle">
            Your session could not be loaded. Return to sign in and try again.
          </p>
          <button
            className="secondary-button"
            onClick={() => {
              setSession(null);
              setAuthStatus("unauthenticated");
              setAuthError("");
            }}
          >
            Return to sign in
          </button>
        </section>
      </main>
    );
  }

  if (!selectedTenantId || !selectedMembership) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <span className="brand-mark"><Icon name="shield" size={23} /></span>
          <h1>No workspace available</h1>
          <p className="subtitle">
            Your account has no available tenant membership. Ask a platform administrator
            to grant access before opening workspace data.
          </p>
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          <button className="secondary-button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActivePage("Overview")}>
          <span className="brand-mark"><Icon name="database" size={23} /></span>
          <span className="brand-copy"><strong>pg<span>control</span></strong><small>DATABASE PLATFORM</small></span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">P</span>
          <span className="workspace-copy">
            <strong>{selectedMembership.tenant_name}</strong>
            <small>{selectedMembership.tenant_key}</small>
          </span>
          {session.memberships.length > 1 && (
            <select
              aria-label="Select workspace"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              {session.memberships.map((membership) => (
                <option key={membership.tenant_id} value={membership.tenant_id}>
                  {membership.tenant_name}
                </option>
              ))}
            </select>
          )}
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              <p className="nav-heading">{group.section}</p>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  className={`nav-link ${activePage === item.label ? "active" : ""}`}
                  onClick={() => setActivePage(item.label)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.label === "Backups" && <span className="nav-count">2</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon"><Icon name="shield" size={17} /></span>
            <strong>Security overview</strong>
            <p>Keep your databases protected with least-privilege access.</p>
            <button onClick={() => setActivePage("Users & access")}>Review access <Icon name="arrow" size={14} /></button>
          </div>
          <div className="sidebar-user">
            <div className="user-avatar">{session.email.slice(0, 1).toUpperCase()}</div>
            <div className="user-copy">
              <strong>{session.email}</strong>
              <small>{roleLabels[role]}</small>
            </div>
            <button
              className="icon-button user-menu-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => void handleLogout()}
            >
              <Icon name="more" />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14} /><strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects..." aria-label="Search projects" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button notification-button" aria-label="Notifications"><Icon name="bell" /></button>
            <div className="topbar-divider" />
            <button className="topbar-profile" onClick={() => void handleLogout()} title="Sign out">
              <span className="user-avatar small">{session.email.slice(0, 1).toUpperCase()}</span>
              <span><strong>{session.email}</strong><small>{roleLabels[role]} · Sign out</small></span>
              <Icon name="chevron" size={14} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <div className="demo-banner"><span className="demo-dot" /> DEMO PREVIEW <span>Sample data · Not connected to the API</span></div>

          {activePage === "Overview" ? (
            <>
              <section className="page-heading">
                <div><p className="eyebrow">MONDAY, OCTOBER 21</p><h1>Good morning<span>,</span> welcome back.</h1><p className="subtitle">Here's what's happening across your database infrastructure.</p></div>
                {canManage && <button className="primary-button" onClick={() => setActivePage("Projects")}><Icon name="plus" size={17} /> New project</button>}
              </section>

              <section className="metric-grid" aria-label="Platform metrics">
                <article className="metric-card">
                  <div className="metric-top"><span>Total projects</span><span className="metric-icon violet"><Icon name="layers" /></span></div>
                  <div className="metric-value">12</div><div className="metric-foot"><span className="trend-up">↗ 2</span><span>from last month</span></div>
                  <div className="metric-sparkline spark-violet"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>Database instances</span><span className="metric-icon blue"><Icon name="database" /></span></div>
                  <div className="metric-value">28</div><div className="metric-foot"><span className="metric-muted">Across all environments</span></div>
                  <div className="metric-sparkline spark-blue"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>Healthy instances</span><span className="metric-icon green"><Icon name="activity" /></span></div>
                  <div className="metric-value">26<span className="metric-total">/28</span></div><div className="metric-foot"><span className="trend-up">92.8%</span><span>operational</span></div>
                  <div className="progress-track"><span style={{ width: "92.8%" }} /></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>Backups today</span><span className="metric-icon amber"><Icon name="archive" /></span></div>
                  <div className="metric-value">8</div><div className="metric-foot"><span className="metric-muted">Last backup 14 min ago</span></div>
                  <div className="backup-bars">{[30, 55, 42, 78, 50, 90, 65, 100, 68, 84, 58, 75].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
                </article>
              </section>

              <section className="content-grid">
                <article className="panel projects-panel">
                  <div className="panel-heading"><div><h2>Projects</h2><p>Manage your connected project environments</p></div><button className="text-button" onClick={() => setActivePage("Projects")}>View all <Icon name="arrow" size={15} /></button></div>
                  <div className="table-toolbar">
                    <span className="result-count">{visibleProjects.length} projects shown</span>
                    <select value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label="Filter by environment">
                      <option>All environments</option><option>Development</option><option>Production</option>
                    </select>
                  </div>
                  <div className="table-scroll"><table><thead><tr><th>PROJECT</th><th>ENVIRONMENT</th><th>STATUS</th><th>LAST ACTIVITY</th><th /></tr></thead><tbody>
                    {visibleProjects.map((project) => <tr key={project.key}>
                      <td><div className="project-cell"><span className={`project-avatar avatar-${project.key.toLowerCase()}`}>{project.key.slice(0, 1)}</span><span><strong>{project.name}</strong><small>{project.database}</small></span></div></td>
                      <td><span className={`environment-pill ${project.environment === "Production" ? "production" : "development"}`}>{project.environment}</span></td>
                      <td><Status value={project.status} /></td><td className="activity-time">{project.updated}</td>
                      <td><button className="row-action" aria-label={`Open ${project.name}`} onClick={() => setActivePage("Databases")}><Icon name="chevron" size={16} /></button></td>
                    </tr>)}
                    {visibleProjects.length === 0 && <tr><td colSpan={5} className="empty-state">No projects match your search.</td></tr>}
                  </tbody></table></div>
                  <div className="panel-footer"><span>Showing sample projects</span><button onClick={() => setActivePage("Projects")}>All projects <Icon name="arrow" size={14} /></button></div>
                </article>

                <article className="panel health-panel">
                  <div className="panel-heading"><div><h2>Infrastructure health</h2><p>Current instance status</p></div><button className="icon-button subtle" aria-label="More health options"><Icon name="more" /></button></div>
                  <div className="health-score"><div className="health-ring"><div><strong>93<span>%</span></strong><small>HEALTHY</small></div></div><div className="health-summary"><strong>Everything looks good</strong><p>Most database instances are operating normally.</p><span className="health-updated"><span className="status-dot" /> Updated just now (demo)</span></div></div>
                  <div className="health-breakdown"><div><span><i className="legend-dot healthy" /> Healthy</span><strong>26</strong></div><div><span><i className="legend-dot warning" /> Needs attention</span><strong>2</strong></div><div><span><i className="legend-dot offline" /> Offline</span><strong>0</strong></div></div>
                  <button className="health-link" onClick={() => setActivePage("Monitoring")}>View monitoring <Icon name="arrow" size={15} /></button>
                </article>
              </section>

              <section className="panel instances-panel">
                <div className="panel-heading"><div><h2>Database instances</h2><p>Recently accessed database environments</p></div><button className="text-button" onClick={() => setActivePage("Databases")}>Manage instances <Icon name="arrow" size={15} /></button></div>
                <div className="table-scroll"><table><thead><tr><th>DATABASE INSTANCE</th><th>PROJECT</th><th>ENVIRONMENT</th><th>ENGINE</th><th>STATUS</th><th /></tr></thead><tbody>
                  {instances.map((instance) => <tr key={instance.name}><td><div className="database-cell"><span className="database-symbol"><Icon name="database" size={17} /></span><strong>{instance.name}</strong></div></td><td>{instance.project}</td><td>{instance.env}</td><td><span className="engine-label"><span />{instance.version}</span></td><td><Status value={instance.status} /></td><td><button className="row-action" aria-label={`Open ${instance.name}`} onClick={() => setActivePage("Databases")}><Icon name="chevron" size={16} /></button></td></tr>)}
                </tbody></table></div>
              </section>
              <footer className="page-footer"><span>pgcontrol <span>·</span> Database management platform</span><span><i className="status-dot" /> Signed in as {session.email}</span></footer>
            </>
          ) : (
            <section className="placeholder-page">
              <span className="placeholder-icon"><Icon name={navigation.flatMap((group) => group.items).find((item) => item.label === activePage)?.icon ?? "grid"} size={25} /></span>
              <p className="eyebrow">WORKSPACE / {activePage.toUpperCase()}</p>
              <h1>{activePage}</h1>
              <p className="subtitle">This section is part of the planned administration interface.</p>
              <div className="placeholder-card"><strong>{activePage} is not connected yet</strong><p>The dashboard currently uses sample data. This page needs a matching backend endpoint and authorization checks before it can display real information or perform operations.</p><button className="secondary-button" onClick={() => setActivePage("Overview")}>Back to overview</button></div>
            </section>
          )}

          {isViewer && <div className="viewer-note"><Icon name="shield" size={16} /> Viewer preview: management actions are hidden. Server-side permissions must still be enforced.</div>}
        </div>
      </main>
    </div>
  );
}

export default App;
