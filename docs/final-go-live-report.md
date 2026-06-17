# Sponsor Licence — Final Go-Live Production Audit

**Date:** 2026-06-17  
**Audited by:** Automated multi-agent code review  
**Branch:** `dev`  
**Scope:** Full-stack — Server (Node.js / Express / Sequelize) + Frontend (React / Vite)

---

## ⛔ VERDICT: NO GO LIVE

**3 P1 blockers must be resolved before production deployment.  
7 P2 issues should be fixed before or immediately after go-live.**

---

## Severity Classification

| Level | Meaning |
|---|---|
| **P0** | Security boundary breach or data corruption with no mitigation path |
| **P1** | Production-blocking: data integrity risk, UX breaks, or business-rule violation |
| **P2** | Should fix before or during go-live: degraded UX, audit gaps, race conditions |
| **P3** | Enhancement / nice-to-have: no impact on launch safety |

---

## Findings by Domain

### 1. Workflow Engine

#### P1-WE-01 — `roleAutoCompletes()` blanket auto-complete bypasses human review
- **File:** `src/services/licenceStageTask.service.js:940`
- **Code:** `if (dataComplete) return true; // Auto-complete all roles if stage data is fully complete`
- **Risk:** When `ensureStageTasks()` runs (on every `getLicenceStages` call), if the data signal for a stage is `true`, ALL roles — including caseworker and admin — are immediately marked complete without any human action. A sponsor uploading all supporting documents would cause the caseworker's document review task to auto-complete silently. This skips the mandatory human review chain.
- **Frequency:** Triggered on every `GET /stages` request for any application with pre-filled data.
- **Fix:** Remove the blanket `if (dataComplete) return true` line. Only `appStatus === "Approved"` warrants full auto-complete. For all other states, only `sponsor` and `candidate` tasks should auto-complete from data signals.
```js
// BEFORE (dangerous):
function roleAutoCompletes(role, dataComplete, appStatus) {
  if (appStatus === "Approved") return true;
  if (dataComplete) return true;   // ← REMOVE THIS LINE
  return role === "sponsor" || role === "candidate";
}

// AFTER (safe):
function roleAutoCompletes(role, dataComplete, appStatus) {
  if (appStatus === "Approved") return true;
  return role === "sponsor" || role === "candidate";
}
```

---

#### P1-WE-02 — Notification failure crashes task completion response
- **File:** `src/services/licenceStageTask.service.js` — `notifyStageTaskCompleted()` loop
- **Risk:** `await deliver()` calls inside the completion notification loop have no `.catch()`. The task is already marked `completed` in the DB (committed), but if the notification service throws, a 500 is returned to the caller. The sponsor/caseworker sees an error and re-submits, potentially triggering a double-complete attempt that could corrupt the chain.
- **Fix:** Wrap every `deliver()` call in `.catch()` within `notifyStageTaskCompleted()`:
```js
await deliver({ ... }).catch((err) =>
  logger.warn({ err, stageKey, role }, "notifyStageTaskCompleted: deliver failed — task still complete")
);
```

---

#### P2-WE-03 — `ensureStageTasks()` auto-fix runs on every read, creating audit noise
- **File:** `src/services/licenceStageTask.service.js:872-888`
- **Risk:** The data/DB mismatch auto-fix loop (added to unblock frozen chains) fires on every `GET /stages` call, issuing DB UPDATEs and writing audit entries with arbitrary `completedAt` timestamps. In production with many applications, this creates thousands of spurious audit writes and could cause `completedAt` timestamps to drift (making the audit trail unreliable).
- **Fix:** Gate the fix with a one-time migration flag, or add an explicit idempotency guard: only run the fix if `existingRows` contains pending tasks for data-complete stages and the last fix ran more than N minutes ago. Alternatively, ship a one-off migration script to back-fill the DB and remove the runtime check entirely.

---

#### P3-WE-04 — Recursive `seedNextInChain()` missing defensive null check
- **File:** `src/services/licenceStageTask.service.js:808`
- **Risk:** Low. Current logic is safe, but future changes could introduce a null-dereference. Add `if (next)` guard for clarity.

---

### 2. Stage Progression & Authorization

#### ✅ Sequential ordering: `checkSequentialOrder` + `checkIntraStageOrder` + `checkStatusGate` all called — confirmed.
#### ✅ Sponsor IDOR prevention: `userId` check on every `findByPk` — confirmed.
#### ✅ Caseworker assignment guard: `ensureAssignedCaseworker` middleware on all caseworker routes — confirmed.
#### ✅ Admin role gate: `checkRole(ADMIN_ROLES)` applied globally on admin router — confirmed.
#### ✅ Candidate cannot access caseworker/admin endpoints — confirmed.
#### ✅ `stageKey` validated against 18-key allowlist at service layer — confirmed.
#### ✅ `role` validated against 4-key allowlist at service layer — confirmed.
#### ✅ No SQL injection: all queries use Sequelize parameterized syntax — confirmed.
#### ✅ JWT invalidated on password change — confirmed.

#### P2-SP-05 — Missing route-level validation for stage completion
- **File:** `src/modules/Sponsor/Licence/sponsorLicenceV2.routes.js:54`, `caseworker.licence.routes.js:67`, `admin.licence.routes.js:57`
- **Risk:** `stageKey` and `role` are validated at the service layer only. A malformed request reaches the DB before being rejected. Defense-in-depth demands route-level validation.
- **Fix:** Add a lightweight schema validator middleware to all three `POST /:id/stages/:stageKey/complete` routes that asserts `stageKey` is one of the 18 known keys and `role` is one of the 4 known roles.

---

### 3. Task Assignment

#### ✅ `extractCaseworkerIds` returns only positive integers — confirmed.
#### ✅ `isCaseworkerAssigned` applied consistently via `ensureAssignedCaseworker` middleware — confirmed.
#### ✅ "Awaiting Assignment" placeholder does not block stage completion — confirmed.

#### P2-TA-06 — No notification when caseworker is assigned to existing pending task
- **File:** `src/services/licenceStageTask.service.js:695-704`
- **Risk:** When a caseworker is assigned after a task is already seeded, the task row is updated but no notification fires. The caseworker only discovers the task by logging in. Causes delays in processing.
- **Fix:** After updating the task row's assignee, call `deliver()` with a "task assigned to you" notification.

---

### 4. Notifications & Emails

#### ✅ In-app notifications persisted to DB with full model — confirmed.
#### ✅ Email templates use HTML (no raw string injection) — confirmed.
#### ✅ Null-recipient guard prevents SMTP calls to "Awaiting Assignment" — confirmed.
#### ✅ Email failure does not roll back notification persistence — confirmed.

#### P2-NE-07 — Inconsistent `.catch()` on `deliver()` calls in sponsorshipNotification.service.js
- **File:** `src/services/sponsorshipNotification.service.js` — lines 139, 162, 216, 233, 252, 279
- **Risk:** Top-level notification functions (`licenceSubmitted`, `licenceGranted`, `licenceRejected`, `informationRequested`, etc.) call `deliver()` without `.catch()`. If `deliver()` throws (network failure, DB lock, SMTP timeout), the exception propagates to the route handler and returns a 500. The underlying business operation (licence grant, etc.) may already be committed.
- **Fix:** Add `.catch((err) => logger.warn({ err }, "notification failed — business op committed"))` to each bare `deliver()` call, or centralise into the `deliver()` contract.

#### P3-NE-08 — No audit log entry when notification is skipped for unassigned caseworker
- **File:** `src/services/licenceStageTask.service.js:732`
- **Risk:** When `assignee.userId` is null, notifications are silently skipped with no trace. Makes it hard to debug "why didn't the caseworker get notified?"
- **Fix:** Add `logger.debug(...)` or a `notificationSkipped: true` field in the AuditLog details JSON.

---

### 5. Business Profile Sync

#### ✅ `lastSyncedAt` / `lastSyncedByUserId` stamps correctly applied to AO, KC, L1, OrgInfo — confirmed.
#### ✅ Companies House number fill-if-blank guard present — confirmed.
#### ✅ Compliance fields (convictions, immigration status) never overwritten by sync — confirmed.
#### ✅ Missing SponsorProfile returns gracefully (no throw) — confirmed.
#### ✅ Migration `20260622000000-add-profile-sync-tracking.sql` columns match model definitions — confirmed.

#### P2-PS-09 — Authorising Officer `jobTitle` not synced from profile
- **File:** `src/services/licenceApplicationV2.service.js:417-424`
- **Risk:** KC and L1 correctly sync `jobTitle` from profile, but AO sync omits it. Sponsors who enter the AO job title in their profile must re-enter it in the wizard, contradicting the "Business Profile is the primary source" design goal.
- **Fix:**
```js
// In aoData object, add:
jobTitle: profile.authorisingJobTitle || null,
```

---

### 6. Intake Documents

#### ✅ `INTAKE_TO_APPENDIX_MAP` — all 7 keys verified against appendix document types — confirmed.
#### ✅ `importMatchingAppendixDocuments` only fills `pending`/empty slots, never overwrites verified/rejected — confirmed.
#### ✅ `source` field correctly set: `"manual"` on upload, `"imported_from_application"` on auto-attach — confirmed.
#### ✅ Migration `20260621000000-add-source-to-intake-documents.sql` columns match model — confirmed.
#### ✅ Mandatory documents seeded idempotently (`ignoreDuplicates: true`) — confirmed.

#### P2-ID-10 — Document deletion does not reset `verifiedAt` / `verifiedByUserId`
- **File:** `src/modules/Sponsor/Licence/sponsorLicenceIntake.controller.js:172-184`
- **Risk:** When a rejected document is deleted and replaced, the old `verifiedAt` and `verifiedByUserId` timestamps remain in the row. A re-uploaded document appears to have been previously verified by someone, polluting the audit trail and potentially confusing caseworkers reviewing the document history.
- **Fix:** Add two lines to the deletion reset block:
```js
doc.verifiedAt = null;
doc.verifiedByUserId = null;
```

---

### 7. CoS Allocation

#### ✅ `requestedAmount` validated as positive number — confirmed.
#### ✅ Active licence required before CoS request (`requireActiveSponsorLicence` middleware) — confirmed.
#### ✅ CoS requests and allocation records in separate tables with correct FK relationship — confirmed.
#### ✅ Concurrent approval race condition protected via `SELECT FOR UPDATE` + UNIQUE constraint on `cosRequestId` — confirmed.

#### P1-CA-11 — Approved CoS amount can exceed requested amount
- **File:** `src/services/cosRequest.service.js:331-332`
- **Risk:** No validation prevents an admin from approving `approvedAmount: 1000` against a `requestedAmount: 100` request. This over-allocates CoS certificates and could give a sponsor unlimited sponsorship capacity beyond what was justified in their application.
- **Fix:**
```js
if (approvedAmount != null && approvedAmount > request.requestedAmount) {
  const e = new Error("Approved amount cannot exceed requested amount");
  e.statusCode = 400;
  throw e;
}
```

---

### 8. Worker Management

#### ✅ Worker cannot be created without valid CoS ownership check — confirmed.
#### ✅ Worker status FSM validated via `validateTransition()` — no illegal state jumps possible — confirmed.
#### ✅ Worker audit events written atomically within DB transaction — confirmed.
#### ✅ Worker employer ownership verified against sponsorId — confirmed.
#### ✅ DB-level status `CHECK` constraint added by migration `20260619000000` — confirmed.

#### P2-WM-12 — Race condition: worker over-allocation possible under concurrent requests
- **File:** `src/services/sponsoredWorker.service.js:244-255`
- **Risk:** The over-allocation check (`count >= allocation.allocatedAmount`) is a read-then-write without a transaction lock. Two simultaneous worker-creation requests can both read `count = 4` for a 5-slot allocation and both succeed, creating 6 workers for 5 slots.
- **Fix:** Wrap the count + create sequence in a transaction with `CosAllocationRecord` locked `FOR UPDATE`:
```js
await tenantDb.sequelize.transaction(async (t) => {
  const allocation = await tenantDb.CosAllocationRecord.findByPk(id, { lock: true, transaction: t });
  const used = await tenantDb.SponsoredWorker.count({ where: { cosAllocationRecordId: id }, transaction: t });
  if (used >= allocation.allocatedAmount) throw httpError("ALLOCATION_EXCEEDED", 409);
  return tenantDb.SponsoredWorker.create({ ... }, { transaction: t });
});
```

#### P2-WM-13 — Workers hard-deleted (no soft-delete)
- **File:** `src/models/tenant/sponsoredWorker.model.js`
- **Risk:** Worker records are hard-deleted via `.destroy()`. The audit trail (`sponsored_worker_audits`) survives, but the worker record itself is unrecoverable. For UK Home Office compliance (immigration records must be retained for a minimum period), this is a potential regulatory gap.
- **Fix:** Add `paranoid: true` and a `deleted_at` column to the SponsoredWorker model to enable soft-delete.

---

### 9. Transactions & Audit Trail

#### ✅ `completeStageTask` wrapped in a Sequelize transaction — task update and audit log are atomic — confirmed.
#### ✅ Licence grant/reject use `SELECT FOR UPDATE` locks, are fully transactional — confirmed.
#### ✅ `LicenceApplicationAudit` table is immutable (`updatedAt: false`) — confirmed.
#### ✅ All key events logged: task created, completed, assigned, licence granted/rejected — confirmed.
#### ✅ `actorId` is null for system-generated events (documented and expected) — confirmed.
#### ✅ No dual audit trail inconsistency between `AuditLog` and `LicenceApplicationAudit` — confirmed.

#### P2-AT-14 — Task seeding audit log is not transactional
- **File:** `src/services/licenceStageTask.service.js:711-729`
- **Risk:** In `seedSingleTask()`, `LicenceStageTask.findOrCreate()` and `AuditLog.create()` are not in the same transaction. If the audit write fails after the task row is created, the DB contains an unaudited task. The error is silently swallowed via `.catch()`, so there is no indication the audit was missed.
- **Fix:** Pass a shared transaction context through `seedSingleTask`, or at minimum use `Promise.allSettled` and log audit failures as warnings.

---

### 10. Multi-Tenancy

#### ✅ `tenantDb` resolution is strict and fail-fast (invalid org → HTTP 403 with no fallback) — confirmed.
#### ✅ Each tenant has an isolated Sequelize instance (no cross-tenant shared connection pool) — confirmed.
#### ✅ All licence queries operate on `req.tenantDb` — no global table scans observed — confirmed.
#### ✅ Migrations run per-tenant — confirmed.
#### ✅ Superadmin null-tenantDb is handled explicitly — no null-dereference on regular paths — confirmed.

---

## Consolidated Finding Register

| ID | Domain | Severity | Finding | File |
|---|---|---|---|---|
| P1-WE-01 | Workflow Engine | **P1** | `roleAutoCompletes()` blanket auto-complete bypasses caseworker/admin review | licenceStageTask.service.js:940 |
| P1-WE-02 | Notifications | **P1** | `notifyStageTaskCompleted()` deliver() has no .catch() — task completion can return 500 after DB commit | licenceStageTask.service.js (notifyStageTaskCompleted) |
| P1-CA-11 | CoS Allocation | **P1** | Approved CoS amount can exceed requested amount — no upper-bound validation | cosRequest.service.js:331 |
| P2-WE-03 | Workflow Engine | P2 | `ensureStageTasks()` mismatch-fix runs on every read — audit noise + timestamp drift | licenceStageTask.service.js:872 |
| P2-SP-05 | Authorization | P2 | Route-level validation missing for stageKey/role on stage completion | sponsorLicenceV2.routes.js:54 |
| P2-TA-06 | Task Assignment | P2 | No notification when caseworker assigned to pre-existing pending task | licenceStageTask.service.js:695 |
| P2-NE-07 | Notifications | P2 | deliver() calls in sponsorshipNotification.service.js lack .catch() | sponsorshipNotification.service.js:139,162,216,233,252,279 |
| P2-PS-09 | Profile Sync | P2 | AO `jobTitle` not synced from Business Profile | licenceApplicationV2.service.js:423 |
| P2-ID-10 | Intake Docs | P2 | Document deletion does not reset `verifiedAt`/`verifiedByUserId` | sponsorLicenceIntake.controller.js:179 |
| P2-WM-12 | Workers | P2 | Race condition: worker over-allocation under concurrent creation requests | sponsoredWorker.service.js:245 |
| P2-WM-13 | Workers | P2 | Workers hard-deleted — potential UK immigration records retention risk | sponsoredWorker.model.js |
| P2-AT-14 | Audit Trail | P2 | Task seeding audit log not in same transaction as task row creation | licenceStageTask.service.js:711 |
| P3-WE-04 | Workflow Engine | P3 | Recursive seedNextInChain() missing defensive null check | licenceStageTask.service.js:808 |
| P3-NE-08 | Notifications | P3 | No log/trace when notification skipped for unassigned caseworker | licenceStageTask.service.js:732 |

---

## What Is Production-Ready

| Domain | Status | Notes |
|---|---|---|
| Multi-tenancy isolation | ✅ Ready | Strict tenant scoping, no cross-tenant leakage found |
| Authorization / IDOR | ✅ Ready | All routes guarded; sponsor IDOR, caseworker assignment, admin role gates confirmed |
| SQL injection | ✅ Ready | 100% parameterized queries throughout |
| JWT security | ✅ Ready | Password-change invalidation confirmed |
| Stage sequential validation | ✅ Ready | checkSequentialOrder + checkIntraStageOrder + checkStatusGate all enforced |
| Stage SLA indicators | ✅ Ready | computeSlaStatus math correct, all 18 keys present, no timezone issues |
| Intake document import | ✅ Ready | Non-destructive, idempotent, source-tracked |
| Business Profile sync compliance guard | ✅ Ready | Convictions/immigration fields never overwritten |
| CoS race condition on approval | ✅ Ready | SELECT FOR UPDATE + UNIQUE constraint |
| Worker FSM state machine | ✅ Ready | DB-level CHECK constraints + service-layer FSM |
| Worker audit immutability | ✅ Ready | `updatedAt: false`, all transitions audited atomically |
| LicenceApplicationAudit immutability | ✅ Ready | Immutable by model design |
| Workflow timeline aggregation | ✅ Ready | Read-only, multi-source, chronological, role-gated |
| In-app notification persistence | ✅ Ready | Notification model + delivery tracking table confirmed |

---

## Go-Live Blockers (P1 — must fix before deploying)

### Fix 1 of 3 — `roleAutoCompletes()` (P1-WE-01)

**File:** `src/services/licenceStageTask.service.js` — `roleAutoCompletes()` function

Remove line 940:
```js
if (dataComplete) return true;  // DELETE this line entirely
```

This single-line fix prevents caseworker and admin review tasks from being auto-completed when the sponsor's data signal is satisfied. The only legitimate full-auto case is when the application is `"Approved"`, which is already handled by line 939.

---

### Fix 2 of 3 — `notifyStageTaskCompleted()` error isolation (P1-WE-02)

**File:** `src/services/licenceStageTask.service.js` — inside `notifyStageTaskCompleted()`

Wrap all `await deliver()` calls:
```js
await deliver({ ... }).catch((err) =>
  logger.warn({ err, applicationId, stageKey, role }, "notifyStageTaskCompleted: deliver failed — task still marked complete")
);
```

---

### Fix 3 of 3 — CoS approved amount cap (P1-CA-11)

**File:** `src/services/cosRequest.service.js` — inside the approval function, before line 332

```js
const approvedQty = toInt(approvedAmount != null ? approvedAmount : request.requestedAmount);
if (approvedQty > request.requestedAmount) {
  const e = new Error("Approved amount cannot exceed requested amount");
  e.statusCode = 400;
  throw e;
}
```

---

## P2 Remediation Plan (before or immediately post go-live)

| Priority | Fix | Effort |
|---|---|---|
| P2-WE-03 | Convert `ensureStageTasks` mismatch-fix to a one-off migration script | 1h |
| P2-NE-07 | Add `.catch()` to all bare `deliver()` calls in sponsorshipNotification.service.js | 30m |
| P2-PS-09 | Add `jobTitle: profile.authorisingJobTitle \|\| null` to AO sync payload | 5m |
| P2-ID-10 | Reset `verifiedAt`/`verifiedByUserId` to null in document deletion handler | 5m |
| P2-AT-14 | Pass transaction context into seedSingleTask audit write | 1h |
| P2-WM-12 | Wrap worker creation count+insert in `SELECT FOR UPDATE` transaction | 2h |
| P2-WM-13 | Add `paranoid: true` + migration for `deleted_at` on SponsoredWorker | 1h |
| P2-SP-05 | Add zod schema validation middleware to all 3 stage completion routes | 1h |
| P2-TA-06 | Emit notification on caseworker re-assignment to pre-existing tasks | 1h |

---

## Risk Acceptance Table (if P2s are deferred to post-launch)

| Finding | Deferrable? | Conditions |
|---|---|---|
| P2-WE-03 (audit noise) | Yes | Acceptable if audit log volume is monitored; remediate within sprint 1 |
| P2-NE-07 (notification .catch) | Yes | Only affects UX; business op always succeeds; remediate within sprint 1 |
| P2-PS-09 (AO jobTitle) | Yes | Sponsors can manually enter jobTitle; low urgency |
| P2-ID-10 (verifiedAt reset) | Yes | Cosmetic audit issue only; no functional impact |
| P2-AT-14 (audit transaction) | Yes | Risk is low (audit write rarely fails); remediate within sprint 1 |
| P2-WM-12 (race condition) | **No** | Under concurrent load, over-allocation is a real risk; fix before first real worker is created |
| P2-WM-13 (hard-delete) | **No** | UK immigration records retention is a legal obligation; fix before any worker is deleted |
| P2-SP-05 (route validation) | Yes | Service layer already validates; defense-in-depth improvement |
| P2-TA-06 (assignment notify) | Yes | Manual workaround: caseworker checks their queue on login |

---

## Final Verdict

```
⛔  NO GO LIVE

3 P1 blockers identified:

  P1-WE-01  roleAutoCompletes() auto-completes caseworker/admin reviews without human action
  P1-WE-02  Notification failure in notifyStageTaskCompleted() returns 500 after DB commit  
  P1-CA-11  CoS approved amount can exceed requested amount — no upper-bound check

  + 2 P2 findings that must be resolved before first real worker is created:
  P2-WM-12  Worker over-allocation race condition
  P2-WM-13  Workers hard-deleted (UK immigration records retention)

Estimated time to resolve all blockers: 4–6 hours.
After fix, re-audit P1s, then GO LIVE on remaining P2s deferred to sprint 1.
```

---

*Generated by automated multi-agent code review — 2026-06-17*
