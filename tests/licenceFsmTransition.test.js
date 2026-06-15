/**
 * FSM transition tests for the sponsor licence workflow.
 *
 * Covers three categories:
 *   1. Matrix enforcement  — transitions that the LICENCE_TRANSITIONS matrix allows or blocks
 *   2. Null-bypass fixes   — validateTransition no longer returns { valid: true } for unknown
 *                            workflow types or null currentState
 *   3. Role-aware guard    — caseworkers may not record 'Approved'; only ADMIN / SUPERADMIN may
 *
 * Run with:  node --test tests/licenceFsmTransition.test.js
 */

import test from 'node:test';
import assert from 'node:assert';
import { validateTransition, WORKFLOW_TYPES } from '../src/services/workflowEngine.service.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

const LICENCE = WORKFLOW_TYPES.LICENCE;

// Role IDs (mirrors ROLES in role.middleware.js; inline to avoid import coupling)
const CASEWORKER  = 2;
const ADMIN       = 3;
const SUPERADMIN  = 5;

function assertAllowed(result, label) {
  assert.ok(result.valid, `Expected ALLOWED for: ${label} — got: ${result.message}`);
}

function assertBlocked(result, label) {
  assert.ok(!result.valid, `Expected BLOCKED for: ${label}`);
  assert.ok(typeof result.message === 'string' && result.message.length > 0,
    `Blocked result must carry a message for: ${label}`);
}

// ─── 1. Matrix enforcement ────────────────────────────────────────────────────

test('matrix: Draft → Pending is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Draft', 'Pending'), 'Draft→Pending');
});

test('matrix: Pending → Under Review is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Pending', 'Under Review'), 'Pending→Under Review');
});

test('matrix: Under Review → Government Processing is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Under Review', 'Government Processing'), 'Under Review→Gov Processing');
});

test('matrix: Under Review → Information Requested is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Under Review', 'Information Requested'), 'Under Review→Info Requested');
});

test('matrix: Under Review → Rejected is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Under Review', 'Rejected'), 'Under Review→Rejected');
});

test('matrix: Under Review → Approved is BLOCKED (government processing bypass removed)', () => {
  // Core bug fix: no-one can skip Government Processing → Decision Pending.
  assertBlocked(validateTransition(LICENCE, 'Under Review', 'Approved'), 'Under Review→Approved');
});

test('matrix: Government Processing → Decision Pending is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Government Processing', 'Decision Pending'), 'Gov Processing→Decision Pending');
});

test('matrix: Government Processing → Information Requested is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Government Processing', 'Information Requested'), 'Gov Processing→Info Requested');
});

test('matrix: Government Processing → Rejected is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Government Processing', 'Rejected'), 'Gov Processing→Rejected');
});

test('matrix: Decision Pending → Approved is allowed by matrix', () => {
  // Matrix allows this; role-aware guard (tested below) restricts who can do it.
  assertAllowed(validateTransition(LICENCE, 'Decision Pending', 'Approved'), 'Decision Pending→Approved (no role)');
});

test('matrix: Decision Pending → Rejected is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Decision Pending', 'Rejected'), 'Decision Pending→Rejected');
});

test('matrix: Approved → Expired is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Approved', 'Expired'), 'Approved→Expired');
});

test('matrix: Approved → Under Review is BLOCKED (terminal state)', () => {
  assertBlocked(validateTransition(LICENCE, 'Approved', 'Under Review'), 'Approved→Under Review');
});

test('matrix: Rejected → Approved is BLOCKED (Rejected is terminal)', () => {
  assertBlocked(validateTransition(LICENCE, 'Rejected', 'Approved'), 'Rejected→Approved');
});

test('matrix: Rejected → Under Review is BLOCKED (Rejected is terminal)', () => {
  assertBlocked(validateTransition(LICENCE, 'Rejected', 'Under Review'), 'Rejected→Under Review');
});

test('matrix: Expired → Under Review is BLOCKED (Expired is terminal)', () => {
  assertBlocked(validateTransition(LICENCE, 'Expired', 'Under Review'), 'Expired→Under Review');
});

test('matrix: Information Requested → Under Review is allowed', () => {
  assertAllowed(validateTransition(LICENCE, 'Information Requested', 'Under Review'), 'Info Requested→Under Review');
});

test('matrix: nonsense transition Draft → Approved is BLOCKED', () => {
  assertBlocked(validateTransition(LICENCE, 'Draft', 'Approved'), 'Draft→Approved');
});

// ─── 2. Null-bypass fixes ─────────────────────────────────────────────────────

test('null-bypass: unknown workflowType is BLOCKED (no longer valid:true)', () => {
  const result = validateTransition('unknown_workflow_type', 'Under Review', 'Approved');
  assertBlocked(result, 'unknown workflowType');
  assert.ok(result.message.toLowerCase().includes('unknown'), `message should mention "unknown": ${result.message}`);
});

test('null-bypass: null currentState is BLOCKED (no longer valid:true)', () => {
  const result = validateTransition(LICENCE, null, 'Approved');
  assertBlocked(result, 'null currentState');
  assert.ok(result.message.toLowerCase().includes('current state'), `message should mention "current state": ${result.message}`);
});

test('null-bypass: undefined currentState is BLOCKED', () => {
  assertBlocked(validateTransition(LICENCE, undefined, 'Approved'), 'undefined currentState');
});

test('null-bypass: empty-string currentState is BLOCKED', () => {
  assertBlocked(validateTransition(LICENCE, '', 'Approved'), 'empty-string currentState');
});

// ─── 3. Role-aware guard ──────────────────────────────────────────────────────

test('role-guard: CASEWORKER cannot approve from Decision Pending', () => {
  const result = validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: CASEWORKER });
  assertBlocked(result, 'caseworker Decision Pending→Approved');
  assert.ok(
    result.message.toLowerCase().includes('administrator'),
    `message should mention "administrator": ${result.message}`,
  );
});

test('role-guard: CASEWORKER (string "2" from JWT) cannot approve from Decision Pending', () => {
  assertBlocked(
    validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: String(CASEWORKER) }),
    'caseworker (string) Decision Pending→Approved',
  );
});

test('role-guard: ADMIN can approve from Decision Pending', () => {
  assertAllowed(
    validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: ADMIN }),
    'admin Decision Pending→Approved',
  );
});

test('role-guard: ADMIN (string "3" from JWT) can approve from Decision Pending', () => {
  assertAllowed(
    validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: String(ADMIN) }),
    'admin (string) Decision Pending→Approved',
  );
});

test('role-guard: SUPERADMIN can approve from Decision Pending', () => {
  assertAllowed(
    validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: SUPERADMIN }),
    'superadmin Decision Pending→Approved',
  );
});

test('role-guard: SUPERADMIN (string "5" from JWT) can approve from Decision Pending', () => {
  assertAllowed(
    validateTransition(LICENCE, 'Decision Pending', 'Approved', { roleId: String(SUPERADMIN) }),
    'superadmin (string) Decision Pending→Approved',
  );
});

test('role-guard: CASEWORKER CAN reject from Decision Pending (rejection is not admin-only)', () => {
  // Caseworkers may record a government rejection; approval is the admin-only step.
  assertAllowed(
    validateTransition(LICENCE, 'Decision Pending', 'Rejected', { roleId: CASEWORKER }),
    'caseworker Decision Pending→Rejected',
  );
});

test('role-guard: no roleId in options skips role check (backward-compat for callers without roleId)', () => {
  // Existing callers that don't pass options still work; only the matrix check runs.
  assertAllowed(validateTransition(LICENCE, 'Decision Pending', 'Approved'), 'no roleId, Decision Pending→Approved');
});

test('role-guard: CASEWORKER blocked from Pending → Approved (matrix also blocks Under Review→Approved)', () => {
  // The matrix allows Pending → Approved; the role guard blocks it for caseworkers.
  assertBlocked(
    validateTransition(LICENCE, 'Pending', 'Approved', { roleId: CASEWORKER }),
    'caseworker Pending→Approved',
  );
});

test('role-guard: ADMIN can approve from Pending (fast-track)', () => {
  assertAllowed(
    validateTransition(LICENCE, 'Pending', 'Approved', { roleId: ADMIN }),
    'admin Pending→Approved (fast-track)',
  );
});
