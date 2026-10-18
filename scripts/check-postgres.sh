#!/usr/bin/env bash
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"

echo "Checking PostgreSQL at ${PGHOST}:${PGPORT}"

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "ERROR: pg_isready is unavailable. Install PostgreSQL client tools."
  exit 1
fi

if pg_isready -h "$PGHOST" -p "$PGPORT"; then
  echo "PostgreSQL is accepting connections."
else
  echo "ERROR: PostgreSQL is not accepting connections."
  exit 1
fi
