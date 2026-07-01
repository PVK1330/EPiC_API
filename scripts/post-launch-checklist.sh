#!/usr/bin/env bash
# Week 10 Task 15: Post-launch checklist
# Run this after production deployment to verify everything is live and healthy.
#
# Usage: ./post-launch-checklist.sh <api_base_url>
# Example: ./post-launch-checklist.sh https://api.epiccms.com

set -euo pipefail

API_BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[0;32m✓ $*\033[0m"; }
red()   { echo -e "\033[0;31m✗ $*\033[0m"; }
yellow(){ echo -e "\033[0;33m⚠ $*\033[0m"; }

check() {
  local label="$1"; local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local label="$1"
  yellow "$label"
  WARN=$((WARN + 1))
}

echo "============================================"
echo "  EPiC CMS — Post-Launch Checklist"
echo "  Target: $API_BASE"
echo "============================================"

echo ""
echo "── 1. Health & Connectivity ─────────────────"
check "API health check responds" "curl -sf '$API_BASE/api/health' -o /dev/null"
check "Auth endpoint reachable" "curl -sf '$API_BASE/api/auth/login' -o /dev/null -w '%{http_code}' | grep -qE '(400|401|405)'"
check "Public API v1 info endpoint" "curl -sf '$API_BASE/api/v1/info' -o /dev/null -w '%{http_code}' | grep -q '401'"

echo ""
echo "── 2. Database ──────────────────────────────"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-epic_api}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

check "Platform DB connection" "psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' -c 'SELECT 1' -t -q"
check "Organisations table exists" "psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' -c 'SELECT COUNT(*) FROM organisations' -t -q"
check "API keys table exists" "psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' -c 'SELECT COUNT(*) FROM api_keys' -t -q"
check "Webhook endpoints table exists" "psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' -c 'SELECT COUNT(*) FROM webhook_endpoints' -t -q"
check "Usage meters table exists" "psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' -c 'SELECT COUNT(*) FROM usage_meters' -t -q"

echo ""
echo "── 3. Tenant Isolation ──────────────────────"
TENANT_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -q -c "SELECT COUNT(*) FROM organisations WHERE deleted_at IS NULL;" 2>/dev/null | xargs || echo "0")
if [ "$TENANT_COUNT" -gt 0 ]; then
  green "Active tenants found: $TENANT_COUNT"
  PASS=$((PASS + 1))
else
  warn "No active tenants found (may need seeding)"
fi

echo ""
echo "── 4. Backups ───────────────────────────────"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/epic}"
if [ -d "$BACKUP_DIR" ]; then
  RECENT=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime -1 2>/dev/null | wc -l)
  if [ "$RECENT" -gt 0 ]; then
    green "Recent backups found: $RECENT files in last 24h"
    PASS=$((PASS + 1))
  else
    warn "No recent backups found in $BACKUP_DIR (run backup-all-tenants.sh)"
  fi
else
  warn "Backup directory not found: $BACKUP_DIR"
fi

echo ""
echo "── 5. Environment ───────────────────────────"
[ -n "${JWT_SECRET:-}" ] && green "JWT_SECRET set" || red "JWT_SECRET not set"
[ -n "${DB_PASSWORD:-}" ] && green "DB_PASSWORD set" || red "DB_PASSWORD not set"
[ -n "${SENTRY_DSN:-}" ] && green "SENTRY_DSN set" || warn "SENTRY_DSN not set (monitoring disabled)"
[ -n "${REDIS_URL:-}" ] && green "REDIS_URL set" || warn "REDIS_URL not set (in-memory cache only)"
[ -n "${BACKUP_S3_BUCKET:-}" ] && green "BACKUP_S3_BUCKET set" || warn "BACKUP_S3_BUCKET not set (local backup only)"

echo ""
echo "============================================"
echo "  Results: $PASS passed | $FAIL failed | $WARN warnings"
echo "============================================"

[ "$FAIL" -eq 0 ] && echo -e "\033[0;32m✓ Post-launch checklist PASSED\033[0m" || echo -e "\033[0;31m✗ Post-launch checklist FAILED — fix issues before going live\033[0m"

[ "$FAIL" -eq 0 ]
