#!/usr/bin/env bash
# Week 9 Task 7: Restore a tenant database from a backup file.
# Usage: ./restore-tenant.sh <tenant_slug> <backup_file.sql.gz>
#
# WARNING: This DROPS and RECREATES the target database. Use with caution.

set -euo pipefail

TENANT="${1:-}"
BACKUP_FILE="${2:-}"

if [ -z "$TENANT" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <tenant_slug> <backup_file.sql.gz>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

echo "[$(date -Iseconds)] Restoring $TENANT from $BACKUP_FILE"
echo "WARNING: This will drop and recreate database '$TENANT'. Press Ctrl+C to cancel."
sleep 5

# Drop and recreate
psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TENANT' AND pid <> pg_backend_pid();" postgres

dropdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --if-exists "$TENANT"
createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$TENANT"

# Restore
gunzip -c "$BACKUP_FILE" | psql \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$TENANT" \
  --quiet

echo "[$(date -Iseconds)] Restore complete: $TENANT"
