# Licence Activation Callers Report

**Generated**: 2026-06-16  
**Issues addressed**: ISSUE-006 (triple activation paths), ISSUE-013 (legacy Approved dead-end)

---

## activateSponsorLicence() — Caller Map

`Server/src/services/licenceActivation.service.js`

### Authoritative caller (KEEP)

| File | Function | Trigger | Notes |
|------|----------|---------|-------|
| `src/services/licenceGrant.service.js` | `grantLicence()` | `Decision Pending → Licence Granted` | Correct. Runs inside one outer transaction with `SELECT FOR UPDATE` lock on `LicenceApplication`. Passes `transaction` handle so `activateSponsorLicence` participates in the same unit of work. |

### Legacy callers (REMOVED — ISSUE-013)

| File | Function | Trigger | Why removed |
|------|----------|---------|-------------|
| `src/modules/Admin/Settings/licenceManagement.controller.js` | `updateLicenceApplicationStatus()` | `status === "Approved"` | Dead-end legacy path. `Approved → Expired` has no route to `Licence Granted`. Called `activateSponsorLicence` without a transaction, bypassing the outer lock introduced in ISSUE-001/003. Created split-state risk when activation succeeded but the downstream `application.save()` or `LicenceGrantRecord.create()` failed. |
| `src/modules/Caseworker/caseworkerLicence.controller.js` | `updateLicenceReviewStatus()` | `status === "Approved"` | Same as above. Additionally allowed caseworkers to trigger activation — activation is an admin/superadmin-only action gated by the transition matrix (`roleId` check). |

---

## Changes Made

### `src/services/licenceActivation.service.js`

Added **idempotency guard** (ISSUE-006) immediately after the profile is loaded and `isRenewal` is computed:

```js
const alreadyActive =
  profile.licenceStatus === LICENCE_STATUS.ACTIVE && !!profile.sponsorLicenceNumber;
if (alreadyActive && !isRenewal) {
  logger.warn({ ... }, "activateSponsorLicence: profile already Active — returning early (idempotency guard)");
  return { profile, licenceNumber: profile.sponsorLicenceNumber, wasActive: true };
}
```

**What the guard prevents:**
- Double-activation: expiry date overwrite on a second call
- Re-seeding the CoS pool with the default value (5), potentially overwriting a higher admin-set allocation
- Duplicate activation notifications (portal + email) to the sponsor
- Duplicate activation audit entries

**Renewal exception:** `Renewal` applications bypass the guard — intentionally extending the expiry date is the purpose of a renewal call.

### `src/modules/Admin/Settings/licenceManagement.controller.js`

- Removed import: `activateSponsorLicence, isCosRequestApplication`
- Removed block: `if (status === "Approved" && !isCosRequestApplication(application)) { await activateSponsorLicence(...) }`
- Added comment explaining that activation is owned by `grantLicence()`

### `src/modules/Caseworker/caseworkerLicence.controller.js`

- Removed import: `activateSponsorLicence, isCosRequestApplication`
- Removed block: `if (status === 'Approved' && !isCosRequestApplication(application)) { await activateSponsorLicence(...) }`
- Added comment explaining that caseworkers advance review stages only; granting is admin-only via the dedicated endpoint

---

## Transition Path Clarification

```
Draft
  └─▶ Pending
        └─▶ Under Review
              ├─▶ Information Requested ──▶ Under Review (loop)
              ├─▶ Government Processing
              │     └─▶ Decision Pending
              │             ├─▶ Licence Granted  ◀── activateSponsorLicence() called HERE only
              │             └─▶ Licence Rejected
              └─▶ Rejected  (legacy terminal)

  Legacy dead-end (ISSUE-013):
  Decision Pending ──▶ Approved ──▶ Expired   (no activation path — removed)
```

The `Approved` status remains in the FSM transition matrix (used by some legacy records in the database) but `activateSponsorLicence` is no longer called when an application transitions to `Approved`. Any existing `Approved` records that need activation should be migrated to `Licence Granted` via the `grantLicence()` endpoint.

---

## Remaining Callers After Fix

Running `grep -r "activateSponsorLicence" src/` after the fix will show:

1. **`src/services/licenceActivation.service.js`** — the definition (expected)
2. **`src/services/licenceGrant.service.js`** — the sole call site (correct)
3. **`src/validations/sponsor.validation.js`** — comment/documentation reference only (no call)
4. **`src/services/sponsorshipNotification.service.js`** — comment reference only (no call)

No unexpected callers remain.
