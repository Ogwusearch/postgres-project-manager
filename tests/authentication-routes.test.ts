import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createLoginThrottle } from "../src/services/login-throttle.js";
import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";
import {
  hashPassword,
  hashToken,
} from "../src/services/authentication.js";

const userId = "12a0f0e1-6734-4d87-97fd-4ecb1a000002";
const tenantId = "12a0f0e1-6734-4d87-97fd-4ecb1a000001";
const email = "auth-test@example.test";
const password = "correct-horse-battery-staple-2026";
const passwordHashPromise = hashPassword(password);

interface TestUser {
  id: string;
  email: string;
  password_hash: string;
  is_super_admin: boolean;
  status: "active" | "disabled";
}

interface TestSession {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  client_ip: string | null;
}

class AuthTestExecutor implements SqlExecutor {
  readonly user: TestUser;
  readonly sessions = new Map<string, TestSession>();

  constructor(passwordHash: string) {
    this.user = {
      id: userId,
      email,
      password_hash: passwordHash,
      is_super_admin: false,
      status: "active",
    };
  }

  async query<Row = Record<string, unknown>>(
    statement: string,
    parameters: unknown[] = [],
  ) {
    const sql = statement.replace(/\s+/g, " ").trim();
    let rows: Record<string, unknown>[] = [];

    if (
      sql.startsWith("SELECT id, email, password_hash, is_super_admin, status FROM public.users")
    ) {
      rows = parameters[0] === this.user.email ? [this.user] : [];
    } else if (sql.startsWith("INSERT INTO public.auth_sessions")) {
      const [
        id,
        sessionUserId,
        tokenHash,
        csrfHash,
        expiresAt,
        userAgent,
        clientIp,
      ] = parameters;

      const session: TestSession = {
        id: String(id),
        user_id: String(sessionUserId),
        token_hash: String(tokenHash),
        csrf_token_hash: String(csrfHash),
        expires_at: new Date(expiresAt as string | number | Date),
        revoked_at: null,
        user_agent: userAgent as string | null,
        client_ip: clientIp as string | null,
      };

      this.sessions.set(session.token_hash, session);
    } else if (
      sql.includes("FROM public.auth_sessions AS s") &&
      sql.includes("JOIN public.users AS u")
    ) {
      const session = this.sessions.get(String(parameters[0]));

      if (
        session &&
        session.revoked_at === null &&
        session.expires_at.getTime() > Date.now() &&
        this.user.status === "active" &&
        session.user_id === this.user.id
      ) {
        rows = [{
          id: session.id,
          user_id: session.user_id,
          csrf_token_hash: session.csrf_token_hash,
          expires_at: session.expires_at,
          user_agent: session.user_agent,
          client_ip: session.client_ip,
          email: this.user.email,
          is_super_admin: this.user.is_super_admin,
          user_status: this.user.status,
        }];
      }
    } else if (
      sql.startsWith("UPDATE public.auth_sessions SET revoked_at = now()")
    ) {
      const session = this.sessions.get(String(parameters[0]));

      if (session && session.revoked_at === null) {
        session.revoked_at = new Date();
      }
    } else if (sql.startsWith("UPDATE public.auth_sessions SET last_seen_at = now()")) {
      // No-op for this suite; session activity is not part of the assertions.
    } else if (sql.includes("FROM public.tenant_memberships AS m")) {
      rows = parameters[0] === this.user.id
        ? [{
            tenant_id: tenantId,
            tenant_key: "test-tenant",
            tenant_name: "Test Tenant",
            tenant_status: "active",
            role: "admin",
          }]
        : [];
    } else {
      throw new Error(`Unexpected SQL in authentication route test: ${sql}`);
    }

    return {
      rows: rows as Row[],
      rowCount: rows.length,
    };
  }

  expireSession(rawToken: string): void {
    const session = this.sessions.get(hashToken(rawToken));
    assert.ok(session, "Expected the login-created session to exist");
    session.expires_at = new Date(Date.now() - 1000);
  }
}

type TestApp = ReturnType<typeof createApp>;

async function setup() {
  const executor = new AuthTestExecutor(await passwordHashPromise);
  const app = createApp(executor);
  return { app, executor };
}

function getSetCookieHeaders(response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] {
  const raw = response.headers["set-cookie"];
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

function cookiePairs(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  return getSetCookieHeaders(response)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

async function login(app: TestApp) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });

  assert.equal(response.statusCode, 200);

  const cookie = cookiePairs(response);
  const csrfToken = cookieValue(cookie, "ppm_csrf");

  assert.ok(cookieValue(cookie, "ppm_session"));
  assert.ok(csrfToken);
  assert.match(
    getSetCookieHeaders(response).join("\n"),
    /ppm_session=.*HttpOnly/i,
  );

  return { cookie, csrfToken };
}

test("login throttling returns 429 and Retry-After without creating a session", async () => {
  const executor = new AuthTestExecutor(await passwordHashPromise);
  const loginThrottle = createLoginThrottle({
    windowMs: 60_000,
    maxFailuresPerIp: 10,
    maxFailuresPerAccount: 1,
  });
  const app = createApp(executor, { loginThrottle });

  try {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "incorrect-password" },
    });

    assert.equal(firstResponse.statusCode, 401);
    assert.equal(executor.sessions.size, 0);

    const blockedResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });

    assert.equal(blockedResponse.statusCode, 429);
    assert.equal(blockedResponse.headers["retry-after"], "60");
    assert.deepEqual(blockedResponse.json(), {
      error: "Too many login attempts. Please try again later.",
    });
    assert.equal(getSetCookieHeaders(blockedResponse).length, 0);
    assert.equal(executor.sessions.size, 0);
  } finally {
    await app.close();
  }
});

test("login rejects an invalid password with a generic response", async () => {
  const { app, executor } = await setup();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "definitely-not-the-password" },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: "Invalid email or password.",
    });
    assert.equal(executor.sessions.size, 0);
  } finally {
    await app.close();
  }
});

test("unknown email returns the same generic response as an invalid password", async () => {
  const { app, executor } = await setup();

  try {
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "definitely-not-the-password" },
    });

    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "unknown-user@example.test", password },
    });

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(unknownEmail.statusCode, 401);
    assert.deepEqual(unknownEmail.json(), wrongPassword.json());
    assert.deepEqual(unknownEmail.json(), {
      error: "Invalid email or password.",
    });
    assert.equal(getSetCookieHeaders(unknownEmail).length, 0);
    assert.equal(executor.sessions.size, 0);
  } finally {
    await app.close();
  }
});

test("disabled users cannot log in or receive session cookies", async () => {
  const { app, executor } = await setup();
  executor.user.status = "disabled";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: "Invalid email or password.",
    });
    assert.equal(getSetCookieHeaders(response).length, 0);
    assert.equal(executor.sessions.size, 0);
  } finally {
    await app.close();
  }
});

test("login creates a session and /me returns the authenticated profile", async () => {
  const { app, executor } = await setup();

  try {
    const credentials = await login(app);
    assert.equal(executor.sessions.size, 1);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: credentials.cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.email, email);
    assert.equal(response.json().data.id, userId);
    assert.deepEqual(response.json().data.memberships, [{
      tenant_id: tenantId,
      tenant_key: "test-tenant",
      tenant_name: "Test Tenant",
      tenant_status: "active",
      role: "admin",
    }]);
  } finally {
    await app.close();
  }
});

test("logout revokes the session and clears both cookies", async () => {
  const { app, executor } = await setup();

  try {
    const credentials = await login(app);
    const sessionToken = cookieValue(credentials.cookie, "ppm_session");
    assert.ok(sessionToken);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: credentials.cookie,
        "x-csrf-token": credentials.csrfToken,
      },
    });

    assert.equal(response.statusCode, 204);

    const session = executor.sessions.get(hashToken(sessionToken));
    assert.ok(session?.revoked_at);

    const clearedCookies = getSetCookieHeaders(response).join("\n");
    assert.match(clearedCookies, /ppm_session=.*Max-Age=0/i);
    assert.match(clearedCookies, /ppm_csrf=.*Max-Age=0/i);

    const profile = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: credentials.cookie },
    });

    assert.equal(profile.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("logout rejects an invalid CSRF token without revoking the session", async () => {
  const { app, executor } = await setup();

  try {
    const credentials = await login(app);
    const sessionToken = cookieValue(credentials.cookie, "ppm_session");
    assert.ok(sessionToken);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: credentials.cookie,
        "x-csrf-token": "incorrect-csrf-token",
      },
    });

    assert.equal(response.statusCode, 403);

    const session = executor.sessions.get(hashToken(sessionToken));
    assert.ok(session);
    assert.equal(session.revoked_at, null);
  } finally {
    await app.close();
  }
});

test("expired sessions are rejected by /me", async () => {
  const { app, executor } = await setup();

  try {
    const credentials = await login(app);
    const sessionToken = cookieValue(credentials.cookie, "ppm_session");
    assert.ok(sessionToken);

    executor.expireSession(sessionToken);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: credentials.cookie },
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("disabled users cannot continue using an existing session", async () => {
  const { app, executor } = await setup();

  try {
    const credentials = await login(app);
    executor.user.status = "disabled";

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: credentials.cookie },
    });

    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
