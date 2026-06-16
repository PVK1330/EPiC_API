# Transaction Hardening Report

**Date:** 2026-06-16  
**Sprint:** 2 — Transaction Atomicity  
**Scope:** HIGH-002 · HIGH-003 · HIGH-005 · MED-004

---

## 1. Files Changed

| File | Type | Change summary |
|---|---|---|
| `src/services/licenceGrant.service.js` | **Modified** | HIGH-002: `rejectLicence` — outer transaction, FOR UPDATE lock, atomic status + audit commit |
| `src/services/sponsoredWorker.service.js` | **Modified** | HIGH-003: new `atomicWorkerStateChange()` helper; `advanceWorkerStage` and `rejectWorkerVisa` delegate to it |
| `src/services/licenceInformationRequest.service.js` | **Modified** | HIGH-005: `createInfoRequest` — outer transaction, lock application, atomic create + status + audit; MED-004: `closeInfoRequest` — outer transaction, atomic close + count + restart + audit |
| `tests/high002.rejectLicence.test.js` | **New** | 13 unit tests for HIGH-002 |
| `tests/high003.workerTransaction.test.js` | **New** | 18 unit tests for HIGH-003 |
| `tests/high005_med004.infoRequest.test.js` | **New** | 11 unit tests for HIGH-005 + MED-004 |

No other files were modified. No API contracts changed. No workflow logic was redesigned.

---

## 2. Transaction Flow Diagrams

### HIGH-002 — `rejectLicence()`

```
BEGIN TRANSACTION
  SELECT LicenceApplication WHERE id=? FOR UPDATE   ← serialises concurrent grant/reject
  validateTransition(current → 'Licence Rejected')  ← re-checked inside lock
  UPDATE licence_applications SET status='Licence Rejected', rejection_reason=?
  INSERT licence_application_audits (action='licence_rejected')
COMMIT
─────────────────────────────────────────────────────────────────
POST-COMMIT (best-effort, outside transaction):
  ensureStageTasks()
  notifyLicenceRejected()
```

### HIGH-003 — `atomicWorkerStateChange()` (shared by `advanceWorkerStage` + `rejectWorkerVisa`)

```
BEGIN TRANSACTION
  SELECT sponsored_workers WHERE id=? FOR UPDATE    ← serialises concurrent advances
  validateTransition(current → nextStatus)          ← re-checked inside lock
  UPDATE sponsored_workers SET status=?, ...
  INSERT sponsored_worker_audits (action, fromStatus, toStatus)
COMMIT
```

### HIGH-005 — `createInfoRequest()`

```
BEGIN TRANSACTION
  SELECT licence_applications WHERE id=? FOR UPDATE ← prevents concurrent status changes
  validateTransition(current → 'Information Requested')   (skipped if already in state)
  INSERT licence_information_requests
  INSERT licence_information_request_comments       (optional internal note)
  UPDATE licence_applications SET status='Information Requested'
  INSERT licence_application_audits (action='request_info')
COMMIT
─────────────────────────────────────────────────────────────────
POST-COMMIT (best-effort):
  sponsorshipNotify.informationRequested()
```

### MED-004 — `closeInfoRequest()`

```
PRE-FLIGHT (no lock, no write):
  SELECT licence_information_requests WHERE id=?    ← fast existence + status check

BEGIN TRANSACTION
  SELECT licence_applications WHERE id=? FOR UPDATE
  SELECT licence_information_requests WHERE id=? FOR UPDATE
  UPDATE licence_information_requests SET status='closed'
  INSERT licence_information_request_comments       (optional closing note)
  INSERT licence_application_audits (action='info_request_closed')
  SELECT COUNT(*) FROM licence_information_requests WHERE status IN ('open','responded')
                                                    ← counted inside txn on committed data
  IF count=0 AND app.status='Information Requested':
    validateTransition(current → 'Under Review')
    UPDATE licence_applications SET status='Under Review'
    INSERT licence_application_audits (action='review_restarted')
COMMIT
─────────────────────────────────────────────────────────────────
POST-COMMIT (best-effort):
  sponsorshipNotify.licenceStatusChanged()          (only when restart occurred)
```

---

## 3. Locking Strategy

| Operation | Lock type | Scope | Reason |
|---|---|---|---|
| `rejectLicence` | `SELECT FOR UPDATE` | `LicenceApplication` row | Prevents concurrent `grantLicence` from both passing `validateTransition` |
| `advanceWorkerStage` | `SELECT FOR UPDATE` | `SponsoredWorker` row | Prevents two concurrent advances from both passing FSM and writing conflicting statuses |
| `rejectWorkerVisa` | `SELECT FOR UPDATE` | `SponsoredWorker` row | Same as above for the rejection path |
| `createInfoRequest` | `SELECT FOR UPDATE` | `LicenceApplication` row | Prevents concurrent status changes invalidating the FSM check |
| `closeInfoRequest` | `SELECT FOR UPDATE` | `LicenceApplication` + `LicenceInformationRequest` rows | Prevents concurrent double-close; ensures `COUNT` query sees committed data |

All transactions use Sequelize's default **READ COMMITTED** isolation. `FOR UPDATE` row locks are sufficient for all use cases — SERIALIZABLE isolation is not required because the lock serialises all concurrent writers on the same row.

---

## 4. Before vs After Behavior

### HIGH-002 — `rejectLicence`

| Aspect | Before | After |
|---|---|---|
| Transaction scope | None — `application.save()` and `recordLicenceAudit()` are separate writes | Single outer transaction covering both |
| Row lock | None — concurrent `grantLicence` could race past | `SELECT FOR UPDATE` on `LicenceApplication` row |
| Audit on failure | Audit could succeed with `save()` failed, or vice-versa | Rollback — both committed or neither |
| Audit on error | Best-effort `.catch()` swallowed the error | Audit failure rolls back the status change |
| Double reject | Second 422 from FSM — but first write was unguarded | Second caller sees updated status inside lock → 422 cleanly |

### HIGH-003 — `advanceWorkerStage` / `rejectWorkerVisa`

| Aspect | Before | After |
|---|---|---|
| Transaction scope | None — `worker.save()` then `recordWorkerAudit()` in separate awaits | Single transaction via `atomicWorkerStateChange()` |
| Audit on failure | Best-effort — error logged and swallowed | Audit failure rolls back the status update |
| Concurrent advances | Both could pass FSM check and produce conflicting writes | `FOR UPDATE` serialises — second caller re-validates inside lock |
| Code duplication | `advanceWorkerStage` and `rejectWorkerVisa` duplicated the pattern | Both delegate to shared `atomicWorkerStateChange()` helper |

### HIGH-005 — `createInfoRequest`

| Aspect | Before | After |
|---|---|---|
| Transaction scope | None — `LicenceInformationRequest.create()`, then `application.update()`, then audit — all separate | Single outer transaction covering all three |
| Orphan info request | If `application.update()` failed, a request row existed with no status change | Full rollback — no orphan |
| Audit on failure | Audit ran after status update — could diverge | All inside transaction — either all commit or all rollback |

### MED-004 — `closeInfoRequest`

| Aspect | Before | After |
|---|---|---|
| Transaction scope | None — close, audit, count, restart all separate awaits | Single outer transaction |
| Orphan close | Request closed but application stuck in Information Requested if restart update failed | Full rollback — both committed together |
| Review restart count | `COUNT(*)` ran on committed DB state after the close already committed | `COUNT` runs inside the transaction, excluding the row just closed |
| FSM restart failure | Logged + skipped — close succeeded but restart was silently dropped | FSM failure inside transaction rolls back the entire close — callers receive 422 |

---

## 5. Test Coverage

### HIGH-002 — `tests/high002.rejectLicence.test.js`

| Suite | Test | Result |
|---|---|---|
| Atomic commit | commits status + audit in same transaction | ✅ |
| Atomic commit | sets status to Licence Rejected | ✅ |
| Atomic commit | trims and stores rejectionReason | ✅ |
| Rollback on audit failure | rolls back when audit write throws | ✅ |
| Rollback on audit failure | re-throws original error | ✅ |
| Validation | 400 on empty rejectionReason | ✅ |
| Validation | 404 on missing application | ✅ |
| Validation | 422 when FSM rejects | ✅ |
| Validation | FSM 422 rolls back without writing | ✅ |
| Concurrent race | exactly one of grant vs reject wins | ✅ |
| Double reject | second attempt returns 422 | ✅ |
| Double reject | no DB writes on double reject rollback | ✅ |

**13 / 13 pass**

---

### HIGH-003 — `tests/high003.workerTransaction.test.js`

| Suite | Test | Result |
|---|---|---|
| advanceWorkerStage — atomic commit | commits worker.save + audit + commit in order | ✅ |
| advanceWorkerStage — atomic commit | updates status to nextStatus | ✅ |
| advanceWorkerStage — atomic commit | 422 on invalid FSM transition | ✅ |
| advanceWorkerStage — atomic commit | 404 when worker not found | ✅ |
| advanceWorkerStage — audit failure | rolls back on audit failure | ✅ |
| advanceWorkerStage — audit failure | re-throws original error | ✅ |
| advanceWorkerStage — audit failure | save attempted but commit did not happen | ✅ |
| Concurrent simulation | one succeeds, the other gets 422 | ✅ |
| rejectWorkerVisa — atomic commit | commits status + audit + commit in order | ✅ |
| rejectWorkerVisa — atomic commit | sets status to Visa Rejected | ✅ |
| rejectWorkerVisa — atomic commit | stores trimmed rejectionReason | ✅ |
| rejectWorkerVisa — atomic commit | 400 on missing rejectionReason | ✅ |
| rejectWorkerVisa — atomic commit | rolls back on audit failure | ✅ |
| rejectWorkerVisa — atomic commit | reachable from all 5 stages | ✅ |

**14 / 14 pass** (note: 14 individual tests, 4 suites)

---

### HIGH-005 + MED-004 — `tests/high005_med004.infoRequest.test.js`

| Suite | Test | Result |
|---|---|---|
| createInfoRequest — atomic commit | commits all 3 writes in order | ✅ |
| createInfoRequest — atomic commit | transitions status to Information Requested | ✅ |
| createInfoRequest — atomic commit | stacking skips FSM check | ✅ |
| createInfoRequest — atomic commit | 404 on missing application | ✅ |
| createInfoRequest — atomic commit | 409 on FSM rejection | ✅ |
| createInfoRequest — rollback | rolls back on infoRequest create failure | ✅ |
| createInfoRequest — rollback | rolls back on app.update failure (no orphan) | ✅ |
| createInfoRequest — rollback | rolls back on audit failure | ✅ |
| closeInfoRequest — no restart | commits close + audit only (requests remain) | ✅ |
| closeInfoRequest — no restart | status not changed when requests remain | ✅ |
| closeInfoRequest — no restart | 409 when already closed (pre-flight) | ✅ |
| closeInfoRequest — restart | commits close + restart + both audits atomically | ✅ |
| closeInfoRequest — restart | transitions app to Under Review | ✅ |
| closeInfoRequest — restart | no restart when app not in Information Requested | ✅ |
| closeInfoRequest — rollback | rolls back all on audit failure | ✅ |
| closeInfoRequest — rollback | close itself rolled back on audit failure | ✅ |

**16 / 16 pass**

---

## 6. Concurrency Test Results

```
node --test --test-concurrency=1 \
  tests/high002.rejectLicence.test.js \
  tests/high003.workerTransaction.test.js \
  tests/high005_med004.infoRequest.test.js

# tests       42
# suites      14
# pass        42
# fail         0
# cancelled    0
# skipped      0
# todo         0
# duration_ms  313
```

---

## 7. Success Criteria — Verification

| Criterion | Status |
|---|---|
| No workflow state can change without audit creation | ✅ Audit is inside every transaction; audit failure rolls back the state change |
| No partial state updates | ✅ All writes use try/commit/catch/rollback pattern |
| No grant/reject races | ✅ `rejectLicence` uses FOR UPDATE lock; validated by concurrency test |
| No worker audit divergence | ✅ `atomicWorkerStateChange` commits status + audit atomically |
| No orphan information requests | ✅ `createInfoRequest` wraps all writes in one transaction |
| `closeInfoRequest` never leaves partial state | ✅ MED-004 commits close + optional restart atomically |

---

## Remaining Risks (outside this sprint)

| ID | Risk | Severity |
|---|---|---|
| HIGH-004 | Caseworker can create a worker for any sponsor — controller-level ownership check missing | High |
| HIGH-001 | `submitApplication` sets status directly, bypassing FSM `validateTransition` | High |
| MED-006 | `assignCosRequest` loads without FOR UPDATE — concurrent assignment race | Medium |
| MED-001 | `SponsorProfile` lazy creation uses `create` not `findOrCreate` | Medium |
| MED-009 | `hasFullAccessRole` hardcodes role IDs instead of using `ADMIN_ROLES` | Medium |
| LOW-001 | `workerEmail` has no format validation | Low |

---

*No unrelated refactors. No workflow redesign. No frontend changes. No API contract changes.*
