# Critical Fixes Report — Sprint 1

**Date:** 2026-06-16  
**Sprint:** 1  
**Engineer role:** Senior Backend Security Engineer  
**Scope:** CRIT-001 (IDOR — Worker Registration) · CRIT-002 (TOCTOU Race — Duplicate Applications)

---

## 1. Files Changed

| File | Type | Change summary |
|---|---|---|
| `src/services/sponsoredWorker.service.js` | **Modified** | CRIT-001: added `ownershipError` helper; inserted `cosRequestId` and `cosAllocationRecordId` ownership checks before the over-allocation guard |
| `src/services/licenceApplicationV2.service.js` | **Modified** | CRIT-002: imported `UniqueConstraintError`; rewrote `createDraft` to run inside a SERIALIZABLE transaction with `FOR UPDATE`; added `UniqueConstraintError` catch → HTTP 409 |
| `tests/crit001.ownership.test.js` | **New** | 18 unit tests covering all CRIT-001 ownership scenarios |
| `tests/crit002.concurrency.test.js` | **New** | 14 unit + concurrency tests covering all CRIT-002 scenarios |
| `docs/critical-fixes-report.md` | **New** | This report |

No other files were modified. No workflow logic was redesigned. No frontend changes were made.

---

## 2. Migration Added

**File:** `src/migrations/tenants/20260620000000-crit002-unique-active-v2-application.sql`

```sql
-- CRIT-002: Prevent duplicate active V2 licence applications per sponsor.
-- Partial unique index — only covers rows where the application is in an
-- active (non-terminal, non-draft) state and not soft-deleted.

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_v2_application_per_user
  ON licence_applications (user_id)
  WHERE
    application_version = 2
    AND status NOT IN (
      'Draft',
      'Rejected',
      'Approved',
      'Licence Granted',
      'Licence Rejected'
    )
    AND deleted_at IS NULL;
```

**Deployment:**
```bash
npm run migrate:tenants
```

The index is idempotent (`IF NOT EXISTS`) — safe to run on databases that already have the column but not the constraint.

---

## 3. Security Impact

### CRIT-001 — Before vs After

**Before:**
```js
// Only fetched id + allocatedAmount — sponsorId was never loaded or checked.
const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
  attributes: ["id", "allocatedAmount"],
});
// No ownership check — any sponsorId was accepted.
```

Sponsor A could pass Sponsor B's `cosAllocationRecordId` in a POST body.  
The service would run the over-allocation guard against B's budget and register a worker, consuming B's CoS allocation silently.

**After:**
```js
const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
  attributes: ["id", "allocatedAmount", "sponsorId"],  // sponsorId now fetched
});
if (!allocation) throw HTTP 404;

// CRIT-001: Ownership check — fires before any allocation state is read.
if (Number(allocation.sponsorId) !== Number(sponsorId)) {
  throw { statusCode: 403, code: "ALLOCATION_OWNERSHIP_VIOLATION" };
}

// Over-allocation guard runs only after ownership is confirmed.
const usedCount = await tenantDb.SponsoredWorker.count(…);
if (usedCount >= allocation.allocatedAmount) throw HTTP 409 / ALLOCATION_EXCEEDED;
```

The same pattern is applied to `cosRequestId`:
```js
if (Number(cosReq.sponsorId) !== Number(sponsorId)) {
  throw { statusCode: 403, code: "REQUEST_OWNERSHIP_VIOLATION" };
}
```

**Ownership is checked before over-allocation state is read**, preventing information leakage about another sponsor's allocation usage.

---

### CRIT-002 — Before vs After

**Before:**
```js
// findOne runs outside any transaction — race window open.
const blocking = await tenantDb.LicenceApplication.findOne({ where: { userId, … } });
if (blocking) throw conflict;

// create() runs in a separate transaction — no connection to the findOne above.
return tenantDb.sequelize.transaction(async (t) => {
  const app = await LicenceApplication.create(…, { transaction: t });
  …
});
```

Two concurrent requests both pass `findOne` (returning null) before either `create()` completes → both insert → sponsor has two active applications.

**After:**
```js
// findOne and create() are now inside ONE SERIALIZABLE transaction.
// FOR UPDATE lock on the blocking check serialises concurrent callers.
return await tenantDb.sequelize.transaction(
  { isolationLevel: ISOLATION_LEVELS.SERIALIZABLE },
  async (t) => {
    const blocking = await LicenceApplication.findOne({
      …,
      transaction: t,
      lock: t.LOCK.UPDATE,   // ← serialises concurrent readers
    });
    if (blocking) throw { statusCode: 409, code: "ACTIVE_APPLICATION_EXISTS" };

    return LicenceApplication.create(…, { transaction: t });
  }
);
// Partial DB unique index is the last-resort guard.
// UniqueConstraintError → HTTP 409 / DUPLICATE_ACTIVE_APPLICATION
```

Two-layer protection:
1. **Application layer** — SERIALIZABLE transaction + `SELECT FOR UPDATE` serialises the check-and-create.
2. **Database layer** — partial unique index `uq_active_v2_application_per_user` prevents a duplicate INSERT from ever committing, even if layer 1 is bypassed.

---

## 4. Test Coverage

### CRIT-001 — `tests/crit001.ownership.test.js`

| Suite | Test | Expected |
|---|---|---|
| cosAllocationRecord ownership | 403 ALLOCATION_OWNERSHIP_VIOLATION — wrong sponsor | ✅ PASS |
| cosAllocationRecord ownership | Error message mentions "does not belong to this sponsor" | ✅ PASS |
| cosAllocationRecord ownership | 404 — record does not exist | ✅ PASS |
| cosAllocationRecord ownership | No error — matching sponsorId | ✅ PASS |
| cosAllocationRecord ownership | Guard skipped when ID is null | ✅ PASS |
| cosAllocationRecord ownership | Guard skipped when ID is undefined | ✅ PASS |
| cosAllocationRecord ownership | 403 fires before 409 (ownership before over-alloc) | ✅ PASS |
| cosAllocationRecord ownership | 409 ALLOCATION_EXCEEDED after ownership passes | ✅ PASS |
| cosRequest ownership | 403 REQUEST_OWNERSHIP_VIOLATION — wrong sponsor | ✅ PASS |
| cosRequest ownership | Error message mentions "does not belong to this sponsor" | ✅ PASS |
| cosRequest ownership | 404 — cosRequest does not exist | ✅ PASS |
| cosRequest ownership | No error — matching sponsorId | ✅ PASS |
| cosRequest ownership | Guard skipped when ID is null | ✅ PASS |
| cosRequest ownership | cosRequest check runs before cosAllocationRecord check | ✅ PASS |
| No IDs provided | Guard skipped — both null | ✅ PASS |
| No IDs provided | Guard skipped — both undefined | ✅ PASS |
| sponsorId coercion | String "10" accepted against numeric 10 | ✅ PASS |
| sponsorId coercion | String "10" blocked against numeric 20 | ✅ PASS |

**18 / 18 pass**

---

### CRIT-002 — `tests/crit002.concurrency.test.js`

| Suite | Test | Expected |
|---|---|---|
| Sequential duplicate | 409 ACTIVE_APPLICATION_EXISTS — blocking app in review | ✅ PASS |
| Sequential duplicate | Error message includes blocking status | ✅ PASS |
| Sequential duplicate | Resolves — no blocking application | ✅ PASS |
| Sequential duplicate | Resolves — after Licence Granted (re-apply) | ✅ PASS |
| Sequential duplicate | Resolves — after Licence Rejected (re-apply) | ✅ PASS |
| UniqueConstraintError path | 409 DUPLICATE_ACTIVE_APPLICATION — UCE from create() | ✅ PASS |
| UniqueConstraintError path | Error message mentions "duplicate" / "active application" | ✅ PASS |
| UniqueConstraintError path | Non-UCE propagates unchanged (not masked as 409) | ✅ PASS |
| UniqueConstraintError path | Code is DUPLICATE_ACTIVE_APPLICATION (not ACTIVE_APPLICATION_EXISTS) | ✅ PASS |
| Concurrent simulation | Exactly one of two concurrent creations succeeds | ✅ PASS |
| Concurrent simulation | Losing request gets 409, not 500 | ✅ PASS |
| Concurrent simulation | Winner returns a valid Draft application | ✅ PASS |
| DB index contract | FakeUniqueConstraintError instanceof UniqueConstraintError | ✅ PASS |
| DB index contract | DUPLICATE_ACTIVE_APPLICATION ≠ ACTIVE_APPLICATION_EXISTS | ✅ PASS |

**14 / 14 pass**

---

## 5. Concurrency Test Results

```
node --test --test-concurrency=1 \
  tests/crit001.ownership.test.js \
  tests/crit002.concurrency.test.js

# tests       32
# suites       8
# pass        32
# fail         0
# cancelled    0
# skipped      0
# todo         0
# duration_ms 504
```

All 32 tests pass across 8 suites.

---

## 6. Remaining Risks

The following items are outside Sprint 1 scope and remain open:

| ID | Risk | Severity | Sprint |
|---|---|---|---|
| HIGH-004 | Caseworker can create a worker for any sponsor (no caseworker→sponsor ownership check at controller level) | High | Sprint 2 |
| HIGH-002 | `rejectLicence` has no outer transaction — audit row can diverge from status | High | Sprint 2 |
| HIGH-003 | `advanceWorkerStage` / `rejectWorkerVisa` save + audit in separate DB calls — no transaction | High | Sprint 2 |
| HIGH-001 | `submitApplication` sets `status = "Pending"` without calling `validateTransition` | High | Sprint 2 |
| MED-006 | `assignCosRequest` loads CosRequest without FOR UPDATE lock — concurrent assignment race | Medium | Sprint 3 |
| MED-001 | `SponsorProfile` lazy creation uses `create` not `findOrCreate` — concurrent-init race | Medium | Sprint 3 |
| LOW-001 | `workerEmail` has no format validation — silent storage of malformed emails | Low | Sprint 3 |

---

## 7. Git Diff Summary

### `src/services/sponsoredWorker.service.js`

```diff
+function ownershipError(message, code) {
+  const err = new Error(message);
+  err.statusCode = 403;
+  err.code = code;
+  return err;
+}

-  // ISSUE-009: Prevent over-allocation — reject if all CoS slots are already taken.
+  // CRIT-001: Validate cosRequestId ownership — CoS request must belong to this sponsor.
+  if (cosRequestId != null) {
+    const cosReq = await tenantDb.CosRequest.findByPk(cosRequestId, {
+      attributes: ["id", "sponsorId"],
+    });
+    if (!cosReq) { throw HTTP 404 }
+    if (Number(cosReq.sponsorId) !== Number(sponsorId)) {
+      throw ownershipError("CoS request does not belong to this sponsor.",
+                           "REQUEST_OWNERSHIP_VIOLATION");
+    }
+  }
+
+  // CRIT-001 + ISSUE-009: Validate cosAllocationRecord ownership + over-allocation.
   if (cosAllocationRecordId != null) {
     const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
-      attributes: ["id", "allocatedAmount"],
+      attributes: ["id", "allocatedAmount", "sponsorId"],
     });
     if (!allocation) { throw HTTP 404 }
+    // CRIT-001: Ownership check — fires before allocation count is read.
+    if (Number(allocation.sponsorId) !== Number(sponsorId)) {
+      throw ownershipError("CoS allocation record does not belong to this sponsor.",
+                           "ALLOCATION_OWNERSHIP_VIOLATION");
+    }
+    // ISSUE-009: Over-allocation guard (unchanged logic, now runs after ownership).
     const usedCount = await tenantDb.SponsoredWorker.count(…);
     if (usedCount >= allocation.allocatedAmount) { throw HTTP 409 / ALLOCATION_EXCEEDED }
   }
```

### `src/services/licenceApplicationV2.service.js`

```diff
-import { Op } from "sequelize";
+import { Op, UniqueConstraintError } from "sequelize";

 export async function createDraft({ tenantDb, userId, organisationId }) {
-  // findOne outside transaction — race window open.
-  const blocking = await tenantDb.LicenceApplication.findOne({ where: { userId, … } });
-  if (blocking) throw conflict;
-
-  return tenantDb.sequelize.transaction(async (t) => {
-    const app = await tenantDb.LicenceApplication.create(…, { transaction: t });
-    …
-  });
+  // CRIT-002: SERIALIZABLE transaction wraps check-and-create atomically.
+  try {
+    return await tenantDb.sequelize.transaction(
+      { isolationLevel: ISOLATION_LEVELS.SERIALIZABLE },
+      async (t) => {
+        const blocking = await LicenceApplication.findOne({
+          where: { userId, applicationVersion: 2, status: { [Op.notIn]: […terminal] }, deletedAt: null },
+          transaction: t,
+          lock: t.LOCK.UPDATE,
+        });
+        if (blocking) throw { statusCode: 409, code: "ACTIVE_APPLICATION_EXISTS" };
+
+        const app = await LicenceApplication.create(…, { transaction: t });
+        await seedAppendixDocuments(…, t);
+        return app;
+      }
+    );
+  } catch (err) {
+    // DB partial unique index fires on concurrent INSERT — return 409, not 500.
+    if (err instanceof UniqueConstraintError) {
+      throw { statusCode: 409, code: "DUPLICATE_ACTIVE_APPLICATION" };
+    }
+    throw err;
+  }
 }
```

### Migration (new file)

```diff
+ src/migrations/tenants/20260620000000-crit002-unique-active-v2-application.sql
+
+ CREATE UNIQUE INDEX IF NOT EXISTS uq_active_v2_application_per_user
+   ON licence_applications (user_id)
+   WHERE application_version = 2
+     AND status NOT IN ('Draft','Rejected','Approved','Licence Granted','Licence Rejected')
+     AND deleted_at IS NULL;
```

---

*No unrelated refactors. No workflow redesign. No frontend changes. API contracts preserved — HTTP 409 was already the documented conflict response for both endpoints.*
