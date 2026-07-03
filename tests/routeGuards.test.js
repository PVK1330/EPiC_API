/**
 * Route-authentication guardrail (regression test for the missing-auth class).
 *
 * Two routers once shipped mounted with NO authentication middleware
 * (/api/caseworker/visa-workers, /api/admin/esignature) — unauthenticated
 * requests reached the controllers and 500'd instead of 401. This test
 * statically audits EVERY *.routes.js and fails if any leaf router neither
 * applies an authentication guard in-file NOR is mounted under a parent router
 * that applies one. A new unguarded router added later will fail CI here.
 *
 * Run:  npm test   (node --test tests/*.test.js)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Tokens that indicate an authentication guard is applied.
const AUTH_TOKENS = [
  'verifyTokenAndTenant',
  'verifyToken',
  'isPlatformStaff',
  'isSuperAdmin',
  'authenticateApiKey',
  'requireCandidate',
  'attachTenantDb',
];

// Directories whose top-level router applies authentication before mounting its
// children, so the child *.routes.js files inherit the guard:
//   - Candidate/index.js  -> verifyTokenAndTenant + requireCandidate
//   - Sponsor/index.js    -> verifyTokenAndTenant + checkRole([BUSINESS])
//   - Superadmin/superadmin.routes.js -> verifyToken + isPlatformStaff (mounts
//     ApiKeys / Webhooks / Usage / GDPR / Sandbox after the guard)
const GUARDED_PARENT_DIRS = [
  join('modules', 'Candidate'),
  join('modules', 'Sponsor'),
  join('modules', 'Superadmin'),
];

// Files intentionally public or mixed-access, reviewed individually.
const PUBLIC_ALLOWLIST = [
  // The aggregator that mounts every sub-router (each carries its own guard).
  join('routes', 'index.js'),
  // Public API v1 aggregator — authenticated per-route via authenticateApiKey.
  join('routes', 'api', 'v1', 'index.js'),
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.routes.js') || name === 'index.js') out.push(p);
  }
  return out;
}

function appliesAuthInFile(content) {
  return AUTH_TOKENS.some((t) => new RegExp(`\\b${t}\\b`).test(content));
}

function isUnderGuardedParent(rel) {
  return GUARDED_PARENT_DIRS.some(
    (d) => rel.startsWith(d + sep) && rel !== join(d, 'index.js'),
  );
}

test('every router applies an authentication guard (in-file or via a guarded parent)', () => {
  // Only audit files that actually define routes (router.get/post/... or .use with a path).
  const files = walk(SRC).filter((p) => {
    const c = readFileSync(p, 'utf8');
    return /router\.(get|post|put|patch|delete|use)\s*\(/.test(c) || /\.route\(/.test(c);
  });

  const violations = [];
  for (const abs of files) {
    const rel = relative(SRC, abs);
    if (PUBLIC_ALLOWLIST.includes(rel)) continue;
    if (isUnderGuardedParent(rel)) continue;

    const content = readFileSync(abs, 'utf8');
    if (!appliesAuthInFile(content)) {
      violations.push(rel);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `\nUnguarded router file(s) found — every router must apply an auth guard ` +
      `(${AUTH_TOKENS.join('/')}) or be mounted under a guarded parent ` +
      `(${GUARDED_PARENT_DIRS.join(', ')}), or be added to PUBLIC_ALLOWLIST with a ` +
      `justification after review:\n  - ${violations.join('\n  - ')}\n`,
  );
});
