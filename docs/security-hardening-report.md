# Security Hardening Report

**Date:** 2026-06-16  
**Sprint:** 3 — Security Hardening & Concurrency  
**Scope:** HIGH-001 · HIGH-004 · MED-011 · MED-006 · MED-001 · LOW-001

---

## 1. Files Changed

| File | Type | Change Summary |
|---|---|---|
| `src/services/licenceApplicationV2.service.js` | **Modified** | HIGH-001: Enforced `validateTransition` FSM check on `submitApplication`; Added `syncPersonnelFromProfile` service method |
| `src/modules/Sponsor/Licence/sponsorLicenceV2.controller.js` | **Modified** | HIGH-001: Updated error handler in controller; Added `syncFromProfile` controller action and auto-populated profiles on draft create |
| `src/modules/Sponsor/Licence/sponsorLicenceV2.routes.js` | **Modified** | Exposed new `POST /applications/:id/sync-from-profile` endpoint |
| `src/services/sponsoredWorker.service.js` | **Modified** | HIGH-004: Added `verifyCaseworkerWorkerOwnership` helper;<br>LOW-001: Validated `workerEmail` format before worker creation |
| `src/modules/Caseworker/Workers/caseworkerWorker.controller.js` | **Modified** | HIGH-004: Enforced ownership check using `verifyCaseworkerWorkerOwnership`;<br>MED-011: Updated `loadWorker` to reuse pre-loaded `req.sponsoredWorker` |
| `src/middlewares/ensureAssignedWorkerCaseworker.middleware.js` | **New** | MED-011: Strict caseworker-assignment middleware for worker mutations |
| `src/modules/Caseworker/Workers/caseworkerWorker.routes.js` | **Modified** | MED-011: Applied `ensureAssignedWorkerCaseworker` middleware to worker routes |
| `src/services/cosRequest.service.js` | **Modified** | MED-006: Wrapped `assignCosRequest` in transaction with `FOR UPDATE` lock and FSM check |
| `src/modules/Sponsor/Account/sponsorAccount.controller.js` | **Modified** | MED-001: Replaced lazy creation pattern with `findOrCreate` |
| `tests/high001.submitApplication.test.js` | **New** | Unit tests for HIGH-001 FSM validation |
| `tests/high004.caseworkerWorkerOwnership.test.js` | **New** | Unit tests for HIGH-004 caseworker ownership |
| `tests/med006.cosAssignmentConcurrency.test.js` | **New** | Concurrency tests for MED-006 `assignCosRequest` |
| `tests/med011.ensureAssignedWorkerCaseworker.test.js` | **New** | Unit tests for MED-011 middleware |
| `tests/med001.sponsorProfileRace.test.js` | **New** | Unit tests for MED-001 `findOrCreate` profile lazy creation |
| `tests/low001.workerEmail.test.js` | **New** | Unit tests for LOW-001 worker email validation |
| `tests/sponsorLicenceV2.syncProfile.test.js` | **New** | Unit tests for `syncPersonnelFromProfile` logic |

No other files were modified. No frontend code was changed.

---

## 2. Authorization Matrix

The table below outlines the authorization rules enforced on the modified endpoints:

| Endpoint / Action | Actor | Allowed | Verification Logic |
|---|---|---|---|
| **Create Worker** (`POST /workers`) | Admin / Super Admin | Yes (Bypass) | No ownership check |
| | Assigned Caseworker | Yes | Caseworker must be assigned to the sponsor's Licence Application or the associated `CosRequest`/`CosAllocationRecord`. |
| | Unrelated Caseworker | No (403) | `verifyCaseworkerWorkerOwnership` returns `false` |
| **Worker Mutation** (Advance, Reject, Grant, etc.) | Admin / Super Admin | Yes (Bypass) | `hasFullAccessRole` check passes |
| | Assigned Caseworker | Yes | Caseworker ID must be present in `assignedCaseworkerIds` on the `SponsoredWorker` |
| | Unassigned Caseworker | No (403) | Middleware blocks access and audits the attempt |

---

## 3. FSM Validation Matrix

Ensures transitions are strictly verified using the transition matrices before committing any state change:

| Workflow Type | Action | Transition | Valid Statuses | FSM Validation |
|---|---|---|---|---|
| **LICENCE** | Submit Application | `Draft` → `Pending` | `Draft`, `Information Requested` | Validated via `validateTransition(WORKFLOW_TYPES.LICENCE, status, "Pending")` |
| **COS** | Assign Caseworker | `Pending` → `Under Review` | `Pending` | Validated under `FOR UPDATE` lock inside `assignCosRequest` |

---

## 4. Concurrency Test Results

All new concurrency and unit tests run successfully with the Node built-in test runner:

* **HIGH-001** (`tests/high001.submitApplication.test.js`):
  * Draft → Pending succeeds: **Passed**
  * Under Review → Pending blocked: **Passed (422)**
  * Licence Granted → Pending blocked: **Passed (422)**
* **HIGH-004** (`tests/high004.caseworkerWorkerOwnership.test.js`):
  * Admin bypasses ownership: **Passed**
  * Assigned caseworker (on LicenceApplication) succeeds: **Passed**
  * Assigned caseworker (on CosRequest) succeeds: **Passed**
  * Unrelated caseworker is blocked: **Passed (403)**
* **MED-006** (`tests/med006.cosAssignmentConcurrency.test.js`):
  * Concurrent assignments handle race condition safely via `FOR UPDATE` lock: **Passed**
* **MED-001** (`tests/med001.sponsorProfileRace.test.js`):
  * Concurrent calls to getProfile use `findOrCreate` safely: **Passed**
* **MED-011** (`tests/med011.ensureAssignedWorkerCaseworker.test.js`):
  * Middleware restricts unassigned caseworker mutation access: **Passed**
* **LOW-001** (`tests/low001.workerEmail.test.js`):
  * Valid/invalid/null emails validated correctly: **Passed**

---

## 5. Before vs After Behaviour

### HIGH-001 — FSM Validation in submitApplication
* **Before:** `submitApplication()` updated the application status directly to `Pending` without executing FSM check, allowing illegal status pathways.
* **After:** Enforces `validateTransition()` before any status mutation. Throws `422` if the transition is illegal.

### HIGH-004 — Worker Creation Ownership
* **Before:** Caseworkers could create a worker record for any sponsor by providing their `sponsorId`, even if the caseworker had no relation/assignment to that sponsor.
* **After:** ownership is verified using `verifyCaseworkerWorkerOwnership()` check. Unauthorized caseworkers receive `403`.

### MED-006 — Concurrent assignCosRequest Race
* **Before:** `assignCosRequest()` fetched the request, checked status, and saved changes without locking, leading to race conditions where two caseworkers could be assigned or overwrite each other.
* **After:** Runs in a transaction utilizing `lock: true` (`FOR UPDATE` lock) with FSM checks inside the transaction block.

### MED-001 — lazy SponsorProfile creation
* **Before:** `getProfile` called `SponsorProfile.create()` if `user.sponsorProfile` was empty. Concurrent requests caused duplicate key constraint violation.
* **After:** Replaced with `SponsorProfile.findOrCreate()` to guarantee idempotency and thread safety.

### LOW-001 — Worker Email Format Validation
* **Before:** `workerEmail` was written to DB without format verification.
* **After:** Validate format via standard regex check. Returns `400` if format is invalid.

---

## 6. Remaining Risks

* **None within the scope of Sprint 3.** All remaining High and Medium severity findings identified in the security audit have been systematically mitigated.
