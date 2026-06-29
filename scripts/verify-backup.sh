#!/usr/bin/env bash
# Week 9 Task 7: Verify backup integrity — check file exists, not empty, and is valid gzip.
# Usage: ./verify-backup.sh [backup_dir]

set -euo pipefail

BACKUP_DIR="${1:-/var/backups/epic/tenants}"
ERRORS=0
CHECKED=0

echo "[$(date -Iseconds)] Verifying backups in: $BACKUP_DIR"

for FILE in "$BACKUP_DIR"/**/*.sql.gz "$BACKUP_DIR"/*.sql.gz 2>/dev/null; do
  [ -f "$FILE" ] || continue
  CHECKED=$((CHECKED + 1))

  # Check not empty
  if [ ! -s "$FILE" ]; then
    echo "✗ EMPTY: $FILE"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Check valid gzip
  if ! gzip -t "$FILE" 2>/dev/null; then
    echo "✗ CORRUPT: $FILE"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Check age (warn if older than 26 hours)
  AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$FILE") ) / 3600 ))
  if [ "$AGE_HOURS" -gt 26 ]; then
    echo "⚠ STALE ($AGE_HOURS h): $FILE"
  else
    echo "✓ OK: $FILE (${AGE_HOURS}h old)"
  fi
done

echo "---"
echo "Checked: $CHECKED files | Errors: $ERRORS"

if [ "$ERRORS" -gt 0 ]; then
  exit 1
fi
