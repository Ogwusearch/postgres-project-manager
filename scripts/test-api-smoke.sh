#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"

PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
COOKIE_JAR="$TMP_DIR/cookies.txt"
LOGIN_BODY="$TMP_DIR/login.json"
PROJECTS_BODY="$TMP_DIR/projects.json"
RESPONSE_BODY="$TMP_DIR/response.json"

trap 'rm -rf "$TMP_DIR"' EXIT

check_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$actual" = "$expected" ]; then
    printf 'PASS: %s (HTTP %s)\n' "$name" "$actual"
    PASS=$((PASS + 1))
  else
    printf 'FAIL: %s (expected HTTP %s, received %s)\n' \
      "$name" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

fail_precondition() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 2
}

status_code() {
  curl -sS -o "$RESPONSE_BODY" -w '%{http_code}' "$@"
}

# Validate configuration before contacting protected endpoints.
: "${SMOKE_TEST_EMAIL:?Set SMOKE_TEST_EMAIL to a dedicated test account email}"
: "${SMOKE_TEST_PASSWORD:?Set SMOKE_TEST_PASSWORD to the test account password}"
: "${SMOKE_TENANT_ID:?Set SMOKE_TENANT_ID to an active tenant UUID}"

health_body="$(curl -fsS "$BASE_URL/health")" ||
  fail_precondition "API health check failed at $BASE_URL/health"

if printf '%s' "$health_body" | grep -q '"database":"connected"'; then
  printf 'PASS: API and database health\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL: API and database health\n'
  FAIL=$((FAIL + 1))
fi

# Build JSON safely without embedding credentials in the script.
LOGIN_JSON="$(
  node -e '
    process.stdout.write(JSON.stringify({
      email: process.env.SMOKE_TEST_EMAIL,
      password: process.env.SMOKE_TEST_PASSWORD
    }));
  '
)"

login_code="$(
  curl -sS \
    -c "$COOKIE_JAR" \
    -o "$LOGIN_BODY" \
    -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    --data "$LOGIN_JSON" \
    "$BASE_URL/api/auth/login"
)" || fail_precondition "Could not reach the login endpoint"

if [ "$login_code" != "200" ]; then
  printf 'FAIL: Authentication (expected HTTP 200, received %s)\n' \
    "$login_code"
  printf 'Check the test account and API logs. Response body was not displayed.\n'
  exit 1
fi

printf 'PASS: Authentication (HTTP 200)\n'
PASS=$((PASS + 1))

CSRF_TOKEN="$(
  awk '$6 == "ppm_csrf" { print $7; exit }' "$COOKIE_JAR"
)"

[ -n "$CSRF_TOKEN" ] ||
  fail_precondition "Login succeeded, but the ppm_csrf cookie was not found"

TENANT_HEADER=("X-Tenant-Id: $SMOKE_TENANT_ID")

# Read first. Never create a duplicate-test project as a fallback.
projects_code="$(
  curl -sS \
    -b "$COOKIE_JAR" \
    -H "${TENANT_HEADER[0]}" \
    -o "$PROJECTS_BODY" \
    -w '%{http_code}' \
    "$BASE_URL/api/projects?limit=100"
)" || fail_precondition "Could not reach the projects endpoint"

check_status "List projects" "200" "$projects_code"

if [ "$projects_code" != "200" ]; then
  printf 'Cannot safely continue without access to the selected tenant.\n'
  exit 1
fi

PROJECT_KEY="$(
  node - "$PROJECTS_BODY" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];

try {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.projects)
        ? payload.projects
        : [];

  const project = rows.find(
    (item) => item && typeof item.project_key === "string"
  );

  if (project) process.stdout.write(project.project_key);
} catch {
  process.exitCode = 1;
}
NODE
)"

if [ -z "$PROJECT_KEY" ]; then
  printf 'SKIP: Duplicate-key test requires an existing project in this tenant.\n'
else
  DUPLICATE_JSON="$(
    PROJECT_KEY="$PROJECT_KEY" node -e '
      process.stdout.write(JSON.stringify({
        project_key: process.env.PROJECT_KEY,
        name: "Smoke duplicate check",
        status: "active"
      }));
    '
  )"

  code="$(
    curl -sS \
      -b "$COOKIE_JAR" \
      -o "$RESPONSE_BODY" \
      -w '%{http_code}' \
      -X POST "$BASE_URL/api/projects" \
      -H 'Content-Type: application/json' \
      -H "${TENANT_HEADER[0]}" \
      -H "x-csrf-token: $CSRF_TOKEN" \
      --data "$DUPLICATE_JSON"
  )"

  check_status "Reject duplicate project key" "409" "$code"
fi

# Invalid status must be rejected by validation before any database write.
INVALID_STATUS_JSON='{"project_key":"smoke-invalid","name":"Invalid Test","status":"unknown"}'

code="$(
  curl -sS \
    -b "$COOKIE_JAR" \
    -o "$RESPONSE_BODY" \
    -w '%{http_code}' \
    -X POST "$BASE_URL/api/projects" \
    -H 'Content-Type: application/json' \
    -H "${TENANT_HEADER[0]}" \
    -H "x-csrf-token: $CSRF_TOKEN" \
    --data "$INVALID_STATUS_JSON"
)"

check_status "Reject invalid project status" "400" "$code"

code="$(
  curl -sS \
    -b "$COOKIE_JAR" \
    -H "${TENANT_HEADER[0]}" \
    -o "$RESPONSE_BODY" \
    -w '%{http_code}' \
    "$BASE_URL/api/projects?limit=500"
)"

check_status "Reject invalid pagination" "400" "$code"

printf '\nResults: %s passed, %s failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
