#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
PASS=0
FAIL=0

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

status_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
}

health_body="$(curl -fsS "$BASE_URL/health")"
if printf '%s' "$health_body" | grep -q '"database":"connected"'; then
  printf 'PASS: API and database health\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL: API and database health\n'
  FAIL=$((FAIL + 1))
fi

code="$(status_code "$BASE_URL/api/projects")"
check_status "List projects" "200" "$code"

code="$(status_code -X POST "$BASE_URL/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{"project_key":"solar-audit","name":"Duplicate SolarAudit","status":"active"}')"
check_status "Reject duplicate project key" "409" "$code"

code="$(status_code -X POST "$BASE_URL/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{"project_key":"smoke-invalid","name":"Invalid Test","status":"unknown"}')"
check_status "Reject invalid project status" "400" "$code"

code="$(status_code "$BASE_URL/api/projects?limit=500")"
check_status "Reject invalid pagination" "400" "$code"

printf '\nResults: %s passed, %s failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
