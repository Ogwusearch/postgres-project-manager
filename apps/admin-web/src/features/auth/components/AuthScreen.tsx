import type { ReactNode, FormEvent } from "react";

type AuthScreenProps = {
  authNotice: string;
  setAuthNotice: (notice: string) => void;
  authError: string;
  setAuthError: (error: string) => void;
  loginEmail: string;
  setLoginEmail: (email: string) => void;
  loginPassword: string;
  setLoginPassword: (password: string) => void;
  loginBusy: boolean;
  handleLogin: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    "arrow-right": <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    "shield-check": <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.database}
    </svg>
  );
}

export default function AuthScreen({
  authNotice,
  setAuthNotice,
  authError,
  setAuthError,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  loginBusy,
  handleLogin,
}: AuthScreenProps) {
  function showNotice(message: string) {
    setAuthError("");
    setAuthNotice(message);
  }

  return (
    <main className="auth-screen">
      <section className="auth-layout" aria-label="pgcontrol authentication">
        <aside className="auth-brand-panel">
          <span className="auth-brand-symbol">
            <Icon name="database" size={28} />
          </span>

          <p className="auth-brand-kicker">DATABASE PLATFORM</p>
          <h1>One control plane.<br />Every project.</h1>
          <p className="auth-brand-description">
            Manage project databases, environments, access, and operations
            from one secure workspace.
          </p>

          <div className="auth-feature-list">
            <div>
              <Icon name="shield-check" size={18} />
              <span>Access controlled by your role</span>
            </div>
            <div>
              <Icon name="database" size={18} />
              <span>Projects and environments in one place</span>
            </div>
            <div>
              <Icon name="activity" size={18} />
              <span>Built for operational visibility</span>
            </div>
          </div>

          <p className="auth-brand-footer">
            PGCONTROL <span>·</span> DATABASE MANAGEMENT
          </p>
        </aside>

        <div className="auth-form-panel">
          <div className="auth-mobile-brand">
            <span className="brand-mark">
              <Icon name="database" size={22} />
            </span>
            <strong>pg<span>control</span></strong>
          </div>

          <form
            className="auth-card auth-card-modern"
            onSubmit={handleLogin}
          >
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Sign in to your account</h2>
            <p className="subtitle">
              Enter your platform credentials to continue.
            </p>

            {authError && (
              <p className="auth-error" role="alert">
                {authError}
              </p>
            )}

            {authNotice && (
              <p className="auth-notice" role="status" aria-live="polite">
                {authNotice}
              </p>
            )}

            <label className="auth-field" htmlFor="login-email">
              Email address
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                required
                maxLength={254}
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
            </label>

            <div className="auth-password-heading">
              <label htmlFor="login-password">Password</label>
              <button
                type="button"
                className="auth-text-link"
                onClick={() => showNotice(
                  "Password recovery is not configured on this server. " +
                  "No email was sent and no password was changed. " +
                  "Contact your platform administrator for assistance."
                )}
              >
                Forgot password?
              </button>
            </div>

            <input
              className="auth-input"
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              maxLength={1024}
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />

            <button
              className="primary-button auth-submit auth-submit-modern"
              type="submit"
              disabled={loginBusy}
            >
              {loginBusy ? "Signing in…" : "Sign in"}
              {!loginBusy && <Icon name="arrow-right" size={17} />}
            </button>

            <p className="auth-switch-line">
              Need an account?{" "}
              <button
                type="button"
                className="auth-text-link"
                onClick={() => showNotice(
                  "Public self-registration is disabled. " +
                  "A platform administrator must provision your account " +
                  "and grant the appropriate workspace access."
                )}
              >
                Request access
              </button>
            </p>

            <p className="auth-security-note">
              <Icon name="shield-check" size={15} />
              Your session is protected by server-side authentication.
            </p>
          </form>

          <footer className="auth-copyright">
            <span>© {new Date().getFullYear()} pgcontrol</span>
            <span>Secure database operations</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
