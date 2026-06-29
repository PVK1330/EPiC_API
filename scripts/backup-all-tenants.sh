#!/usr/bin/env bash
# Week 9 Task 7: Backup ALL tenant databases in one run.
# Discovers tenant DB names from the platform DB (organisations table).
#
# Usage: ./backup-all-tenants.sh
# Schedule via cron: 0 2 * * * /path/to/backup-all-tenants.sh >> /var/log/epic-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/epic/tenants}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
PLATFORM_DB="${DB_NAME:-epic_api}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

echo "========================================"
echo "[$(date -Iseconds)] EPiC All-Tenant Backup Start"
echo "========================================"

# Get all active organisation slugs from platform DB
TENANTS=$(psql \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$PLATFORM_DB" \
  --tuples-only \
  --no-align \
  -c "SELECT slug FROM organisations WHERE deleted_at IS NULL ORDER BY slug;")

TOTAL=0
FAILED=0

for TENANT in $TENANTS; do
  TOTAL=$((TOTAL + 1))
  echo "--- Backing up: $TENANT ---"
  if bash "$SCRIPT_DIR/backup-tenant.sh" "$TENANT" "$BACKUP_DIR"; then
    echo "✓ $TENANT backed up"
  else
    echo "✗ $TENANT backup FAILED"
    FAILED=$((FAILED + 1))
  fi
done

# Backup platform DB itself
echo "--- Backing up platform DB: $PLATFORM_DB ---"
bash "$SCRIPT_DIR/backup-tenant.sh" "$PLATFORM_DB" "$BACKUP_DIR/platform"

echo "========================================"
echo "[$(date -Iseconds)] Backup complete — $TOTAL tenants, $FAILED failed"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
