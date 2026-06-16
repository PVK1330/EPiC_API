# Sponsor Licence Workflow — Final Security & Correctness Audit

**Date:** 2026-06-19  
**Scope:** All five pipeline phases — Sponsor Onboarding, Licence Application, Licence Review, CoS Allocation, Worker Management  
**Audited by:** Claude Code (automated static analysis)  
**Prior fixes applied:** ISSUE-001 through ISSUE-018 (see individual issue history)

---

## Executive Summary

The platform has undergone substantial hardening through prior audit cycles. The critical race conditions in `grantLicence` and `reviewCosRequest` have been resolved with outer transactions and `SELECT FOR UPDATE` locks. FSM enforcement is now the single source of truth for all status transitions across Licence, CoS, and Worker entities. The idempotency guard on `activateSponsorLicence` prevents double-activation, and the over-allocation guard on `createSponsoredWorker` prevents budget overruns.

**Remaining exposure is concentrated in:**
1. A high-severity IDOR in worker registration (sponsor can exhaust another sponsor's CoS allocation).
2. A TOCTOU race in `createDraft` (two concurrent submissions could both create an active application).
3. Absent outer transactions in `rejectLicence`, `advanceWorkerStage`, and `createInfoRequest`.
4. No FSM call in `submitApplication` — a non-Draft application can be re-submitted.

---

## Phase Summary

| Phase | Description | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Phase 1 | Sponsor Onboarding | 0 | 0 | 2 | 1 |
| Phase 2 | Licence Application | 1 | 1 | 2 | 1 |
| Phase 3 | Licence Review | 0 | 2 | 2 | 1 |
| Phase 4 | CoS Allocation | 0 | 0 | 2 | 1 |
| Phase 5 | Worker Management | 1 | 2 | 1 | 1 |
| Cross-cutting | Auth / FSM / DB | 0 | 0 | 2 | 3 |
| **Total** | | **2** | **5** | **11** | **8** |

---

## CRITICAL

---

### CRIT-001 — IDOR: Worker registration does not validate cosAllocationRecordId ownership

**Phase:** 5 — Worker Management  
**File:** `src/services/sponsoredWorker.service.js:122`  
**Status:** Open

**Description:**  
`createSponsoredWorker` accepts `cosAllocationRecordId` from the caller and runs the over-allocation guard against it. However, it never verifies that the allocation record belongs to the calling sponsor. A malicious sponsor can pass the `cosAllocationRecordId` of a different sponsor, incrementing the used count against that sponsor's CoS budget and consuming their allocation without permission.

```js
// Current — no ownership check on the allocation record
const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
  attributes: ["id", "allocatedAmount"],   // sponsorId NOT checked
});
```

**Impact:** Sponsor A can exhaust Sponsor B's CoS allocation, blocking Sponsor B from registering legitimate workers. Depending on how the allocation is invoiced, this may also have financial consequences.

**Fix:**
```js
const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
  attributes: ["id", "allocatedAmount", "sponsorId"],
});
if (!allocation) { ... }
if (Number(allocation.sponsorId) !== Number(sponsorId)) {
  const err = new Error("CoS allocation record does not belong to this sponsor.");
  err.statusCode = 403;
  err.code = "ALLOCATION_OWNERSHIP_VIOLATION";
  throw err;
}
```

---

### CRIT-002 — TOCTOU race in `createDraft` allows duplicate active applications

**Phase:** 2 — Licence Application  
**File:** `src/services/licenceApplicationV2.service.js:133`  
**Status:** Open

**Description:**  
`createDraft` checks for an existing active application with `findOne`, then creates a new one in a separate `create` call. Two concurrent requests from the same sponsor can both pass the blocking check (neither sees the other's in-flight row) and both create a Draft application, violating the business rule of one active application per sponsor.

```js
// Race window between findOne and create
const blocking = await tenantDb.LicenceApplication.findOne({ where: { userId, ... } });
if (blocking) throw conflict;
// <-- concurrent request passes the same check here before either create completes
return tenantDb.sequelize.transaction(async (t) => {
  const app = await tenantDb.LicenceApplication.create({ status: "Draft", ... }, { transaction: t });
```

**Impact:** A sponsor ends up with two simultaneous active applications. Downstream review, activation, and grant logic assumes one application per sponsor.

**Fix:** Wrap the check-and-create in a SERIALIZABLE transaction, or add a partial unique index:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_v2_application_per_user
  ON licence_applications (user_id)
  WHERE status NOT IN ('Draft', 'Rejected', 'Approved', 'Licence Granted', 'Licence Rejected')
    AND application_version = 2
    AND deleted_at IS NULL;
```
The unique index makes the second `create` fail with a `UniqueConstraintError` which is caught and returned as 409.

---

## HIGH

---

### HIGH-001 — `submitApplication` sets status directly, bypassing FSM

**Phase:** 2 — Licence Application  
**File:** `src/services/licenceApplicationV2.service.js` (`submitApplication` function)  
**Status:** Open

**Description:**  
`submitApplication` sets `application.status = "Pending"` (or the equivalent direct update) without calling `validateTransition(WORKFLOW_TYPES.LICENCE, currentStatus, "Pending")`. If a sponsor submits an application that is not in `Draft` status (e.g., a race where two submit requests arrive simultaneously, or an application already `Pending`), the second call succeeds and resets the status without FSM validation.

**Impact:** An application in `Under Review` could be reset to `Pending`, discarding caseworker work in progress. FSM is bypassed.

**Fix:**
```js
const check = validateTransition(WORKFLOW_TYPES.LICENCE, application.status, "Pending");
if (!check.valid) {
  const err = new Error(check.message); err.statusCode = 422; throw err;
}
application.status = "Pending";
```

---

### HIGH-002 — `rejectLicence` has no outer transaction

**Phase:** 3 — Licence Review  
**File:** `src/services/licenceGrant.service.js` (`rejectLicence` function)  
**Status:** Open

**Description:**  
`grantLicence` uses an outer transaction with `SELECT FOR UPDATE`. The sibling function `rejectLicence` does not. The application status update (`application.status = "Licence Rejected"`) and the subsequent audit write are separate DB calls. A process crash between them leaves the application with the new status but no audit record. Concurrent rejection and grant calls are also not serialised.

**Impact:** Partial state — application status updated, audit absent. Concurrent grant+reject race is not prevented on the reject path.

**Fix:** Wrap `rejectLicence` in the same outer-transaction pattern used by `grantLicence`:
```js
const t = await tenantDb.sequelize.transaction();
try {
  const application = await tenantDb.LicenceApplication.findByPk(applicationId, { lock: true, transaction: t });
  // ... validate, update, audit inside t
  await t.commit();
} catch (err) {
  await t.rollback(); throw err;
}
```

---

### HIGH-003 — `advanceWorkerStage` / `rejectWorkerVisa` have no transaction

**Phase:** 5 — Worker Management  
**File:** `src/services/sponsoredWorker.service.js:152, 201`  
**Status:** Open

**Description:**  
Both functions write the new worker status and then write an audit row in separate DB calls with no transaction. A process failure or DB error between the two writes results in a worker whose status has changed but whose audit trail shows no record of the transition.

```js
await worker.save();                    // status updated
await recordWorkerAudit(tenantDb, ...); // audit — separate, no txn
```

`recordWorkerAudit` swallows errors silently (best-effort), which means even DB failures are not surfaced. The worker state and its audit trail can diverge permanently.

**Impact:** Audit trail gaps for worker status changes. Compliance risk — the immutable audit trail is the primary evidence of the visa workflow path.

**Fix:** Wrap the save + audit write in a transaction. The audit write should be inside the transaction (not best-effort) for state-change operations, since divergence is a compliance failure:
```js
await tenantDb.sequelize.transaction(async (t) => {
  worker.status = nextStatus;
  await worker.save({ transaction: t });
  await tenantDb.SponsoredWorkerAudit.create({ ... }, { transaction: t });
});
```

---

### HIGH-004 — Caseworker can create a worker for any sponsor

**Phase:** 5 — Worker Management  
**File:** `src/modules/Caseworker/Workers/caseworkerWorker.controller.js` (`createWorkerHandler`)  
**Status:** Open

**Description:**  
The `createWorkerHandler` accepts `sponsorId` from the request body and passes it to `createSponsoredWorker` without verifying that the caseworker is assigned to that sponsor's CoS request or application. Any authenticated caseworker can register a worker against any sponsor in the system.

**Impact:** A caseworker can associate workers with sponsors they have no relationship to, polluting those sponsors' worker lists and triggering notifications.

**Fix:** Either validate that `req.user.userId` is in the `assignedCaseworkerIds` of the linked `cosAllocationRecord` or `cosRequest`, or add an explicit ownership check at the controller level (similar to `ensureAssignedCaseworker` for CoS mutation routes).

---

### HIGH-005 — `createInfoRequest` status change and record creation not in a transaction

**Phase:** 3 — Licence Review  
**File:** `src/services/licenceInformationRequest.service.js:44`  
**Status:** Open

**Description:**  
`createInfoRequest` updates the application's status to `"Information Requested"` and then creates the `LicenceInformationRequest` row in separate awaits. A process failure after the status update but before the row creation leaves the application in `Information Requested` status with no associated request, making it impossible for the sponsor to respond.

```js
await application.update({ status: "Information Requested" }); // step 1
const infoRequest = await tenantDb.LicenceInformationRequest.create(...); // step 2
```

**Impact:** Application stuck in `Information Requested` with no visible request for the sponsor. Requires manual DB remediation.

**Fix:** Wrap both writes in a single transaction.

---

## MEDIUM

---

### MED-001 — SponsorProfile lazy creation race in `getProfile`

**Phase:** 1 — Sponsor Onboarding  
**File:** `src/modules/Sponsor/Account/sponsorAccount.controller.js:70`  
**Status:** Open

**Description:**  
`getProfile` calls `SponsorProfile.create({ userId })` if no profile exists for the requesting user. Two concurrent requests from the same user (e.g., app startup loading multiple tabs) both query and find no profile, then both attempt to create one. The second `create` will fail with a `UniqueConstraintError` on `userId` (if a unique index exists), or silently create a duplicate (if it does not).

**Fix:** Wrap in `findOrCreate` or use upsert with a unique constraint on `userId`:
```js
const [profile] = await tenantDb.SponsorProfile.findOrCreate({
  where: { userId },
  defaults: { userId },
});
```

---

### MED-002 — Sponsor can submit application without completing registration

**Phase:** 1 → 2 boundary  
**File:** `src/modules/Sponsor/Account/sponsorAccount.controller.js` (`updateProfile`)  
**Status:** Open

**Description:**  
The `fullRegistration` validation (requiring `companyName` + `registrationNumber`) only runs inside `updateProfile`. There is no gate on `createDraft` or `submitApplication` that verifies the SponsorProfile has a `companyName`. A sponsor who never updates their profile can still create and submit a licence application with an empty company name.

**Impact:** Submitted applications with incomplete sponsor data reach caseworkers, causing review failures.

**Fix:** Add a profile completeness check in `createDraft` or `submitApplication`:
```js
const profile = await tenantDb.SponsorProfile.findOne({ where: { userId } });
if (!profile?.companyName) {
  const err = new Error("Complete your company profile before applying.");
  err.statusCode = 422; throw err;
}
```

---

### MED-003 — `saveDraft` service has no application-status guard

**Phase:** 2 — Licence Application  
**File:** `src/services/licenceApplicationV2.service.js` (`saveDraft`)  
**Status:** Open

**Description:**  
The controller checks `EDITABLE = ["Draft", "Information Requested"]` before calling `saveDraft`. The service itself performs no such check. If `saveDraft` is called from a new code path (future endpoint, test, admin tool), it will overwrite fields on any application regardless of status, including `Under Review` or `Decision Pending` applications.

**Fix:** Add a status guard at the top of `saveDraft`:
```js
const EDITABLE = new Set(["Draft", "Information Requested"]);
if (!EDITABLE.has(application.status)) {
  const err = new Error(`Application cannot be edited in status '${application.status}'.`);
  err.statusCode = 409; throw err;
}
```

---

### MED-004 — `closeInfoRequest` auto-restart does not use a transaction

**Phase:** 3 — Licence Review  
**File:** `src/services/licenceInformationRequest.service.js:244`  
**Status:** Open

**Description:**  
`closeInfoRequest` updates the info request to `closed`, then (if no more open requests remain) updates the application status to `Under Review`. These are separate DB calls without a transaction. A process failure between them leaves the request closed but the application status unchanged (`Information Requested`).

**Fix:** Wrap the close + optional status update in a transaction.

---

### MED-005 — ISSUE-016: `COS_APPROVED` is a transient state that is never persisted

**Phase:** 4 — CoS Allocation  
**File:** `src/services/cosRequest.service.js`  
**Status:** Open

**Description:**  
`reviewCosRequest` on the approve path sets `request.status = COS_STATUS.APPROVED` and then immediately sets it to `COS_STATUS.ALLOCATED` before the transaction commits. The `Approved` status is therefore never durably stored in the database — it passes through in-memory and is overwritten in the same transaction. Any code that queries `WHERE status = 'Approved'` to find "approved but not yet allocated" requests will always return zero rows.

**Impact:** Silent logic error for any future feature or report that relies on the `Approved` state persisting. The COS_REQUEST_TRANSITIONS matrix lists `Approved → Allocated` as a separate step, implying it should be observable.

**Fix:** Either:
- (A) Remove `Approved` as a persistent state and rename `ALLOCATED` to mean the result of a single-step approval+allocation action, OR
- (B) Keep `Approved` as a durable state and make the `Approved → Allocated` transition a separate explicit API call (a caseworker approves first, then a second action allocates the CoS slots).

Option B matches the FSM intent. The current code conflates both steps.

---

### MED-006 — `assignCosRequest` loads CosRequest without FOR UPDATE lock

**Phase:** 4 — CoS Allocation  
**File:** `src/services/cosRequest.service.js` (`assignCosRequest`)  
**Status:** Open

**Description:**  
Two concurrent caseworker-assignment calls for the same CoS request both read the request without a lock, both validate `Pending → Under Review`, and both write. The last write wins and overwrites the caseworker assignment list of the first, silently dropping the first assignment.

**Impact:** Concurrent assignment calls produce inconsistent `assignedCaseworkerIds`. Lower severity than the `reviewCosRequest` race because the state change is idempotent (both go to `Under Review`), but data (caseworker list) can be lost.

**Fix:** Apply the outer-transaction + `lock: true` pattern used in `reviewCosRequest`.

---

### MED-007 — `validatePhaseGate` uses hard-coded status strings

**Phase:** 2–3 boundary  
**File:** `src/services/workflowEngine.service.js` (`validatePhaseGate`)  
**Status:** Open

**Description:**  
`validatePhaseGate` contains inline status string comparisons (`=== "Under Review"`, `=== "Approved"`) rather than referring to the `LICENCE_TRANSITIONS` matrix keys. Adding a new pipeline status (e.g., `"Under Admin Review"`) requires updating both the FSM matrix and `validatePhaseGate` separately, with no compile-time or test guarantee they stay in sync.

**Impact:** Low immediate risk; high long-term maintenance risk.

**Fix:** Derive phase-gate eligibility from the FSM matrix itself using reachability analysis rather than hard-coded strings.

---

### MED-008 — `licenceStageTask` `deriveStageCompletion` uses heuristic inference

**Phase:** 2–5 cross-cutting  
**File:** `src/services/licenceStageTask.service.js`  
**Status:** Open (technical debt)

**Description:**  
`deriveStageCompletion` infers which stages are complete by examining application fields (e.g., `submittedAt`, `governmentSubmissionRef`, `infoReceivedAt`). This is fragile: adding a new field to the application model does not automatically update the completion logic, and the heuristics can produce false positives (a field may be set by a migration or admin fix, not by the actual stage completion action).

**Impact:** Stage tasks incorrectly seeded as complete; caseworkers see a misleading progress view.

**Fix:** Store stage completion explicitly in the `LicenceStageTask` rows and derive aggregate state from them, rather than inferring from parent application fields.

---

### MED-009 — `hasFullAccessRole` hardcodes role IDs rather than using `ADMIN_ROLES`

**Phase:** Cross-cutting  
**File:** `src/middlewares/role.middleware.js:34`  
**Status:** Open

**Description:**  
```js
export function hasFullAccessRole(roleId) {
  const id = Number(roleId);
  return id === ROLES.ADMIN || id === ROLES.SUPERADMIN; // hardcoded, not ADMIN_ROLES
}
```
`ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPERADMIN]` exists for exactly this purpose. Adding a new privileged role to `ADMIN_ROLES` would not automatically propagate to `hasFullAccessRole` checks scattered across controllers and services.

**Fix:**
```js
export function hasFullAccessRole(roleId) {
  return ADMIN_ROLES.includes(Number(roleId));
}
```

---

### MED-010 — No validation that `cosRequestId` belongs to the calling sponsor on CoS request reads

**Phase:** 4 — CoS Allocation  
**File:** `src/modules/Sponsor/Licence/sponsorCos.controller.js`  
**Status:** Open

**Description:**  
The sponsor-facing CoS endpoints (`GET /requests/:id/allocation`, `PUT /requests/:id`, `DELETE /requests/:id`) load the CoS request by `id` and check `sponsorId === req.user.userId` at the service layer. This pattern is correct, but the allocation record endpoint (`getCosAllocationRecordForSponsor`) needs independent verification — if the sponsorId check is missing or skipped on any code path, a sponsor can read another sponsor's allocation details.

Needs verification that every sponsor-facing CoS read endpoint includes the `sponsorId` filter.

---

### MED-011 — Worker stage advance does not check caseworker assignment

**Phase:** 5 — Worker Management  
**File:** `src/modules/Caseworker/Workers/caseworkerWorker.controller.js` (`advanceStageHandler`)  
**Status:** Open

**Description:**  
`advanceStageHandler` calls `advanceWorkerStage` after checking `hasFullAccessRole || isCaseworkerAssigned` inline. However, `isCaseworkerAssigned` checks `worker.assignedCaseworkerIds` which is only set by `assignWorkerCaseworkers`. If no caseworkers have been assigned yet (`assignedCaseworkerIds` is null), the `isCaseworkerAssigned` check returns `false` and the hasFullAccessRole branch is the only gate. A caseworker would be blocked, but there is no fallback to load the CoS request and check assignment at that level. The check is inconsistent with the CoS route approach (middleware-level).

**Fix:** Use a dedicated `ensureAssignedWorkerCaseworker` middleware (mirroring `ensureAssignedCaseworker` for CoS) on `PATCH /:id/stage`, `PATCH /:id/grant`, `PATCH /:id/reject`.

---

## LOW

---

### LOW-001 — ISSUE-011: No email format validation for `workerEmail`

**Phase:** 5 — Worker Management  
**File:** `src/services/sponsoredWorker.service.js:99`  
**Status:** Open (carried from original audit)

**Description:**  
`workerEmail` is passed directly to `SponsoredWorker.create` with only a `.trim()`. No format validation is applied. Invalid emails are silently stored and will cause notification delivery failures later in the workflow.

**Fix:**
```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (workerEmail && !EMAIL_RE.test(workerEmail.trim())) {
  const err = new Error("workerEmail is not a valid email address.");
  err.statusCode = 400; throw err;
}
```

---

### LOW-002 — `extractCaseworkerIds` duplicated across three service files

**Phase:** Cross-cutting  
**File:** `src/services/licenceAssignment.service.js`, `src/services/cosRequest.service.js`, `src/services/sponsoredWorker.service.js`  
**Status:** Technical debt

**Description:**  
The `extractCaseworkerIds` utility function (normalises JSONB array of numeric/string/object caseworker IDs to a clean int array) is defined independently in three files with slight variations. If a new JSONB shape is introduced (e.g., `{ caseworkerId: x }`), all three copies must be updated.

**Fix:** Extract to `src/utils/caseworkerIds.js` and import from there.

---

### LOW-003 — V1 licence routes coexist with V2 with no explicit deprecation path

**Phase:** 2 — Licence Application  
**File:** `src/modules/Sponsor/index.js:32-33`  
**Status:** Technical debt

**Description:**  
Both `sponsorLicenceRoutes` (V1) and `sponsorLicenceV2Routes` (V2) are mounted simultaneously. There is no version sunset date, no deprecation header, and no guard preventing sponsors from mixing V1 and V2 applications. The V2 controller has a blocking check for existing active applications but it only blocks `applicationVersion = 2` duplicates, not cross-version duplicates.

---

### LOW-004 — `rejectWorkerVisa` does not check if the worker is already `Visa Rejected`

**Phase:** 5 — Worker Management  
**File:** `src/services/sponsoredWorker.service.js:201`  
**Status:** Open

**Description:**  
The FSM (`validateTransition`) will correctly block `Visa Rejected → Visa Rejected`, but the error message will be a generic FSM message rather than a business-meaningful "worker visa is already rejected". The function should perform an explicit idempotency check before FSM validation and return a clear 409.

---

### LOW-005 — Licence number generation uses `padStart(6)` which wraps after 999999 users

**Phase:** 3 — Licence Activation  
**File:** `src/services/licenceActivation.service.js`  
**Status:** Low-risk long-term

**Description:**  
`generateLicenceNumber(profile, application)` presumably uses `userId.toString().padStart(6, "0")`. For user IDs above 999999 the padding overflows. At current scale this is not a concern, but a system with 1M+ users would produce duplicate-capable licence numbers. The unique index on `licenceGrantRecords.licenceNumber` provides a last-resort DB guard, but the collision would produce an unhelpful 500.

---

### LOW-006 — `deleteDraft` guard is only in controller, not service

**Phase:** 2 — Licence Application  
**File:** `src/modules/Sponsor/Licence/sponsorLicenceV2.controller.js` (`deleteDraft`)  
**Status:** Low

**Description:**  
The controller checks `application.status !== "Draft"` before calling `deleteDraft`. The service itself has no such guard. Future callers that bypass the controller can delete non-Draft applications.

---

### LOW-007 — `getApplicationAuditTrail` has no ownership scope for admin paths

**Phase:** 2–3  
**File:** `src/modules/Sponsor/Licence/sponsorLicenceV2.controller.js`  
**Status:** Low

**Description:**  
The audit trail endpoint calls `loadFullApplication` with `ownerUserId = req.user.userId` for sponsor access (correct), but there is no corresponding admin endpoint with `ownerUserId = undefined` (unrestricted access). Admins who need to view the timeline must use the same sponsor-scoped endpoint or a different path. Verify the admin audit trail route exists.

---

### LOW-008 — Notification failures in `activateSponsorLicence` are fully silent after commit

**Phase:** 3 — Licence Activation  
**File:** `src/services/licenceActivation.service.js`  
**Status:** Low

**Description:**  
Post-commit side effects (sponsor notification, caseworker notification) are wrapped in `try/catch` that only logs. There is no retry mechanism, dead-letter queue, or alerting if a licence is granted but the sponsor never receives their notification email. At scale, silent notification failures cause support escalations.

---

## Fixed Issues (confirmed resolved in prior audit cycles)

| ID | Description | Phase | Fix applied |
|---|---|---|---|
| ISSUE-001 | `grantLicence` lacked outer transaction | 3 | Outer transaction wrapping lock → activate → save → grant record → audit |
| ISSUE-003 | No `SELECT FOR UPDATE` on `LicenceApplication` during grant | 3 | `findByPk(id, { lock: true, transaction: t })` |
| ISSUE-004 | `reviewCosRequest` race condition — no transaction, no lock | 4 | Outer transaction + `CosRequest` FOR UPDATE lock |
| ISSUE-005 | `reviewCosRequest` bypassed FSM via manual REVIEWABLE array | 4 | Replaced with `validateTransition(WORKFLOW_TYPES.COS, ...)` |
| ISSUE-006 | `activateSponsorLicence` could be called multiple times | 3 | Idempotency guard: return early if already Active + has licence number (non-renewal) |
| ISSUE-007 | Sponsor could set `Information Requested → Pending` (invalid) | 2 | Fixed to `Information Requested → Under Review` via FSM |
| ISSUE-008 | `LicenceGrantRecord.create` UniqueConstraintError → HTTP 500 | 3 | `catch (UniqueConstraintError)` → 409 `DUPLICATE_GRANT` |
| ISSUE-009 | CoS over-allocation not prevented | 5 | Pre-create count check against `allocatedAmount` → 409 `ALLOCATION_EXCEEDED` |
| ISSUE-010 | `SponsoredWorker.status` no DB CHECK constraint | 5 | Migration `20260619000000` adds CHECK on 7 FSM values |
| ISSUE-012 | `sponsorLicenceV2.routes.js` had no own auth middleware | 2 | `router.use(verifyTokenAndTenant)` + `checkRole([ROLES.BUSINESS])` added |
| ISSUE-013 | Legacy `Approved` activation callers in two controllers | 3 | Removed both; `grantLicence` is sole activation path |
| ISSUE-014 | CoS mutation routes had no assignment ownership check | 4 | `ensureAssignedCaseworker` middleware on approve/reject/request-info |
| ISSUE-015 | `closeInfoRequest` direct status update bypassed FSM | 3 | Wrapped in `validateTransition` before `application.update` |
| ISSUE-017 | `cos_requests.status` no DB CHECK constraint | 4 | Migration `20260619000000` adds CHECK on 8 FSM values (including terminal states) |
| ISSUE-018 | Sequelize model ENUM values absent from PostgreSQL migrations | 2–3 | Migration adds `Government Processing`, `Decision Pending`, `Expired` |

---

## Remaining Technical Debt

These items do not represent bugs or security vulnerabilities but will require attention before the system can be considered production-ready at scale.

| ID | Item | Effort | Priority |
|---|---|---|---|
| DEBT-001 | `extractCaseworkerIds` duplicated in 3 service files | Small | Low |
| DEBT-002 | V1 + V2 licence routes coexist with no deprecation strategy | Medium | Medium |
| DEBT-003 | `deriveStageCompletion` heuristic inference (field-based, fragile) | Large | Medium |
| DEBT-004 | `validatePhaseGate` hardcodes status strings instead of deriving from FSM | Medium | Low |
| DEBT-005 | No retry / dead-letter queue for failed post-commit notifications | Large | Medium |
| DEBT-006 | Licence number generation with `padStart(6)` wraps past 999999 users | Small | Low |
| DEBT-007 | `hasFullAccessRole` should use `ADMIN_ROLES` array, not hardcoded constants | Trivial | Low |
| DEBT-008 | No automated integration tests that run against a real Sequelize/PostgreSQL stack | Large | High |
| DEBT-009 | Worker and CoS audit trails use best-effort writes — compliance trail can diverge from state | Medium | High |

---

## Audit Dimensions Summary

### Race Conditions

| Location | Status |
|---|---|
| `grantLicence` — concurrent grants | **Fixed** (ISSUE-001/003) |
| `reviewCosRequest` — concurrent approvals | **Fixed** (ISSUE-004) |
| `createDraft` — concurrent draft creation | **Open** (CRIT-002) |
| `assignCosRequest` — concurrent caseworker assignment | **Open** (MED-006) |
| `SponsorProfile` lazy creation | **Open** (MED-001) |
| `advanceWorkerStage` — concurrent stage advances | **Open** (HIGH-003) |

### Transaction Boundaries

| Operation | Transactional? |
|---|---|
| `grantLicence` (lock → activate → save → audit) | Yes — outer transaction |
| `reviewCosRequest` (lock → save → allocate → record) | Yes — outer transaction |
| `rejectLicence` | No — open (HIGH-002) |
| `createInfoRequest` (status + row create) | No — open (HIGH-005) |
| `closeInfoRequest` (close + status restart) | No — open (MED-004) |
| `submitApplication` (status + mirror + audit) | Partial — no lock |
| `advanceWorkerStage` (save + audit) | No — open (HIGH-003) |
| `createSponsoredWorker` (guard + create + audit) | No |

### FSM Enforcement

| Transition | Enforced? |
|---|---|
| Licence Draft → Pending (submit) | No — direct set (HIGH-001) |
| Licence Pending → Under Review (assign) | Yes — via `validateTransition` |
| Licence → Licence Granted (grant) | Yes — `validateTransition` + role check |
| Licence Information Requested → Under Review (info close) | Yes — ISSUE-015 fixed |
| CoS Pending → Under Review (assign) | Yes — ISSUE-005 fixed |
| CoS Under Review → Approved (review) | Yes — ISSUE-005 fixed |
| CoS Approved → Allocated (inline in reviewCosRequest) | Yes — but Approved never persisted (MED-005) |
| Worker stage advances | Yes — `validateTransition(WORKFLOW_TYPES.WORKER)` |
| Sponsor → Licence Granted (blocked) | Yes — role guard in FSM |

### Role Authorization

| Route / Action | Guard | Status |
|---|---|---|
| Sponsor V2 routes | `verifyTokenAndTenant` + `checkRole([ROLES.BUSINESS])` | Fixed (ISSUE-012) |
| CoS assign/review/info-request (caseworker) | `checkRole(STAFF_ROLES)` + `ensureAssignedCaseworker` | Fixed (ISSUE-014) |
| Licence grant | `validateTransition` role check (ADMIN/SUPERADMIN only) | Fixed (ISSUE-013) |
| Worker create (caseworker path) | `checkRole(STAFF_ROLES)` only — no ownership check | Open (HIGH-004) |
| Worker stage advance | Inline `hasFullAccessRole || isCaseworkerAssigned` | Open (MED-011) |

### Database Constraints

| Constraint | Status |
|---|---|
| `licence_grant_records.licence_application_id` UNIQUE | Exists — prevents double grant |
| `cos_allocation_records.cos_request_id` UNIQUE | Exists — prevents double allocation |
| `sponsored_workers.status` CHECK | Added (ISSUE-010 migration) |
| `cos_requests.status` CHECK | Added (ISSUE-017 migration) |
| `licence_applications.status` ENUM completeness | Fixed (ISSUE-018 migration) |
| `licence_applications` unique active application per sponsor | Missing — open (CRIT-002) |
| `sponsored_workers.worker_email` format | Not enforced — open (LOW-001) |

### Audit Trails

| Audit | Correctness |
|---|---|
| `LicenceApplicationAudit` on grant | Inside transaction — correct |
| `LicenceApplicationAudit` on reject | Outside transaction — can diverge (HIGH-002) |
| `LicenceApplicationAudit` on info request | Outside transaction — can diverge (HIGH-005) |
| `SponsoredWorkerAudit` on stage advance | Outside transaction, best-effort — can diverge (HIGH-003) |
| `CosAllocationRecord` creation | Inside transaction — correct (ISSUE-004) |

---

*Generated by automated static analysis. All file paths are relative to `Server/src/`. Line numbers are approximate and should be verified before implementing fixes.*
