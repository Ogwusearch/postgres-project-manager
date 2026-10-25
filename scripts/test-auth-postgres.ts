import dotenv from "dotenv";
import pg from "pg";
import { homedir } from "node:os";
import { join } from "node:path";
import { PgSqlExecutor } from "@postgres-project-manager/postgres-admin";
import { createApp } from "../src/app.js";

dotenv.config();
dotenv.config({
  path: join(
    homedir(),
    ".config",
    "postgres-project-manager",
    "provision-postgres.env",
  ),
});

const database = "ppm_test_control_migrations_disposable_20261019";
const email = process.env.PPM_AUTH_TEST_EMAIL?.trim();
const password = process.env.PPM_AUTH_TEST_PASSWORD;

if (!email || !password) {
  throw new Error("Set PPM_AUTH_TEST_EMAIL and PPM_AUTH_TEST_PASSWORD first.");
}

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? "55433"),
  user: process.env.PGUSER ?? "ppm_registry_app",
  password: process.env.PGPASSWORD,
  database,
  connectionTimeoutMillis: 5000,
  max: 2,
  application_name: "ppm-auth-postgres-route-test",
});

const app = createApp(new PgSqlExecutor(pool));

function cookiesFrom(response: {
  headers: Record<string, string | string[] | undefined>;
}) {
  const raw = response.headers["set-cookie"];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function cookieValue(cookies: string[], name: string) {
  const entry = cookies.find((value) =>
    value.startsWith(`${name}=`)
  );
  if (!entry) return undefined;
  return decodeURIComponent(entry.slice(name.length + 1).split(";")[0]);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const identity = await pool.query(
    "SELECT current_database() AS db, current_user AS role",
  );

  assert(identity.rows[0].db === database, "Connected to the wrong database.");
  assert(identity.rows[0].role === "ppm_registry_app", "Unexpected runtime role.");
  console.log("PASS: Connected to the disposable database as runtime role.");

  // Verify that failed logins do not disclose whether an account exists.
  const wrongPassword = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: `${password}-incorrect` },
  });

  const unknownEmail = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "unknown-auth-test-user@example.invalid",
      password,
    },
  });

  const genericLoginError = {
    error: "Invalid email or password.",
  };

  assert(
    wrongPassword.statusCode === 401,
    `Wrong password returned HTTP ${wrongPassword.statusCode}.`,
  );
  assert(
    unknownEmail.statusCode === 401,
    `Unknown email returned HTTP ${unknownEmail.statusCode}.`,
  );
  assert(
    JSON.stringify(wrongPassword.json()) === JSON.stringify(genericLoginError),
    "Wrong-password response was not the expected generic error.",
  );
  assert(
    JSON.stringify(unknownEmail.json()) === JSON.stringify(genericLoginError),
    "Unknown-email response was not the expected generic error.",
  );
  assert(
    cookiesFrom(wrongPassword).length === 0 &&
      cookiesFrom(unknownEmail).length === 0,
    "A failed login unexpectedly issued cookies.",
  );
  console.log("PASS: Wrong-password and unknown-email logins return generic 401 responses.");

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });

  assert(login.statusCode === 200, `Login failed with HTTP ${login.statusCode}.`);
  const setCookies = cookiesFrom(login);
  const session = cookieValue(setCookies, "ppm_session");
  const csrf = cookieValue(setCookies, "ppm_csrf");

  assert(session, "Login did not issue the session cookie.");
  assert(csrf, "Login did not issue the CSRF cookie.");
  assert(
    setCookies.some((value) =>
      /^ppm_session=.*HttpOnly/i.test(value)
    ),
    "Session cookie is missing HttpOnly.",
  );
  console.log("PASS: Login succeeded and issued session/CSRF cookies.");

  const cookieHeader = `ppm_session=${encodeURIComponent(session)}; ppm_csrf=${encodeURIComponent(csrf)}`;

  const profile = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookieHeader },
  });

  assert(
    profile.statusCode === 200,
    `/api/auth/me failed with HTTP ${profile.statusCode}.`,
  );
  assert(
    profile.json().data?.email === email.toLowerCase(),
    "Profile email does not match the logged-in account.",
  );
  console.log("PASS: /api/auth/me returned the authenticated profile.");

  // An invalid CSRF token must not revoke the authenticated session.
  const rejectedLogout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      cookie: cookieHeader,
      "x-csrf-token": "deliberately-invalid-csrf-token",
    },
  });

  assert(
    rejectedLogout.statusCode === 403,
    `Invalid-CSRF logout returned HTTP ${rejectedLogout.statusCode}, expected 403.`,
  );

  const profileAfterRejectedLogout = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookieHeader },
  });

  assert(
    profileAfterRejectedLogout.statusCode === 200,
    "Session became unusable after an invalid-CSRF logout attempt.",
  );
  console.log("PASS: Invalid-CSRF logout is rejected and the session remains valid.");

  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      cookie: cookieHeader,
      "x-csrf-token": csrf,
    },
  });

  assert(
    logout.statusCode === 204,
    `Logout failed with HTTP ${logout.statusCode}.`,
  );
  console.log("PASS: Logout succeeded with CSRF validation.");

  const afterLogout = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookieHeader },
  });

  assert(
    afterLogout.statusCode === 401,
    `Revoked session remained usable (HTTP ${afterLogout.statusCode}).`,
  );
  console.log("PASS: Revoked session can no longer authenticate.");
  console.log("RESULT: All PostgreSQL authentication route checks passed.");
} catch (error) {
  console.error(
    "AUTHENTICATION TEST FAILED:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
} finally {
  await app.close();
  await pool.end();
}
