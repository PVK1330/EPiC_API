#!/usr/bin/env bash
# Week 9 Task 7: Tenant data backup — automated per-tenant PostgreSQL backup
# Usage: ./backup-tenant.sh <tenant_slug_or_db_name> [backup_dir]
#
# Env vars required:
#   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, BACKUP_S3_BUCKET (optional)

set -euo pipefail

TENANT="${1:-}"
BACKUP_DIR="${2:-/var/backups/epic/tenants}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

if [ -z "$TENANT" ]; then
  echo "Usage: $0 <tenant_slug> [backup_dir]"
  exit 1
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

BACKUP_FILE="${BACKUP_DIR}/${TENANT}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup: $TENANT → $BACKUP_FILE"

pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-acl \
  "$TENANT" | gzip -9 > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($SIZE)"

# Optional: upload to S3
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  S3_KEY="backups/tenants/${TENANT}/${TENANT}_${TIMESTAMP}.sql.gz"
  aws s3 cp "$BACKUP_FILE" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" --quiet
  echo "[$(date -Iseconds)] Uploaded to s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
fi

# Retention: keep last 30 days locally
find "$BACKUP_DIR" -name "${TENANT}_*.sql.gz" -mtime +30 -delete
echo "[$(date -Iseconds)] Old backups pruned (>30 days)"
