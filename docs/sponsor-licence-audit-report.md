# Sponsor Licence Workflow Audit Report

**Date:** 2026-06-16  
**Audited by:** Automated Multi-Agent Code Review  
**Scope:** Phase 1–5 Sponsor Licence Workflow (Licence Application, CoS Allocation, Sponsored Worker Visa Pipeline)

---

## Executive Summary

The six-dimension review of the Phase 1–5 Sponsor Licence Workflow identified **14 distinct failures** and **9 warnings** across 7 audit dimensions, against **22 passing checks**. The most critical deficiencies are a missing outer database transaction in `grantLicence()` that can leave `SponsorProfile` in an Active state while the application record remains ungranted, a non-existent PostgreSQL function (`jsonb_contains`) that causes a runtime crash on every caseworker worker-list request, and two confirmed race conditions — one on licence grant and one on CoS request approval — where the only protection is a database unique-constraint violation that surfaces to callers as an unhandled HTTP 500. The workflow FSM is broadly enforced for the worker visa pipeline but is bypassed entirely for all CoS status transitions and circumvented by two controller-layer status mutations on the licence pathway.

---

## Audit Dimensions & Results

### 1. Stage Skipping & Status Transitions

| Check | Result | Details |
|---|---|---|
| Valid paths from `Pending` to `Licence Granted` via LICENCE_TRANSITIONS | WARNING | `Draft` is not an FSM state. The legacy `Pending → Approved` transition is a dead-end branch: `activateSponsorLicence` fires but the application can never subsequently reach `Licence Granted`. |
| COS `Pending → Allocated` without going through `Approved` | FAIL | `reviewCosRequest()` internally mutates `Pending → Approved → Allocated` in one transaction without ever calling `validateTransition`. The FSM matrix is entirely bypassed. |
| Worker skipping `Immigration Assessment` (CoS Assigned → Visa Preparation) | PASS | `advanceWorkerStage()` calls `validateTransition`; the jump is blocked with HTTP 422. |
| Controllers bypassing `validateTransition` | FAIL | `sponsorLicence.controller.js` line 168 performs an unauthorized `Information Requested → Pending` mutation with no FSM call. `licenceInformationRequest.service.js` line 299 directly writes `Under Review` without invoking the workflow engine. |
| `licenceGrant.service.js` calls `validateTransition` before mutating status | PASS | Called with `roleId` in both `grantLicence()` and `rejectLicence()` before any write. |
| `reviewCosRequest()` calls `validateTransition` | FAIL | Not called. An inline `REVIEWABLE` array check is used in isolation; changes to the FSM matrix are not reflected here. |
| `sponsoredWorker.service.js` calls `validateTransition` for all status changes | PASS | `advanceWorkerStage()` and `rejectWorkerVisa()` both call `validateTransition`; initial creation is exempt as an entry-point assignment. |

---

### 2. Duplicate Task Creation & Orphan Tasks

| Check | Result | Details |
|---|---|---|
| `ensureStageTasks()` uses `findOrCreate` (not plain `create`) | PASS | Exclusively uses `LicenceStageTask.findOrCreate()` at line 626; no bare `.create()` exists. |
| UNIQUE constraint on `(licenceApplicationId, stageKey, role)` at model and DB level | PASS | Enforced in both `licenceStageTask.model.js:104` and migration `20260613120000`. |
| `ensureStageTasks()` is idempotent on repeated calls | PASS | Uses a `rowStatus` Map and skips completed rows; `findOrCreate` handles concurrent races safely. |
| Double `ensureStageTasks()` call risk on a single status change | FAIL (WARNING) | Three independent code paths can each trigger `activateSponsorLicence()` — `licenceManagement.controller.js:194`, `caseworkerLicence.controller.js:92`, and `licenceGrant.service.js:62`. The `ensureStageTasks` duplication is idempotent and harmless, but the triple `activateSponsorLicence` path is not. |
| `LicenceStageTask` rows cascade-delete on `LicenceApplication` hard-delete | PASS | `ON DELETE CASCADE` in both model and migration. Soft-delete retains rows intentionally. |
| `CosAllocationRecord` cascade-deletes on `CosRequest` hard-delete | PASS | `ON DELETE CASCADE` in both `cosAllocationRecord.model.js:16` and migration `20260616140000`. |
| `SponsoredWorkerAudit` cascade-deletes on `SponsoredWorker` hard-delete | PASS | `ON DELETE CASCADE` in `sponsoredWorkerAudit.model.js:15`. |
| `LicenceGrantRecord` cannot be created twice for the same application | FAIL | DB UNIQUE constraint on `licenceApplicationId` exists but is the only guard. A duplicate `create()` attempt throws an uncaught `UniqueConstraintError` returning HTTP 500 rather than 409. No application-layer pre-check exists. |

---

### 3. Business Profile Integration

| Check | Result | Details |
|---|---|---|
| `requireActiveSponsorLicence` middleware check correctness | PASS | Correctly queries `SponsorProfile`, returns HTTP 403 with `INACTIVE_LICENCE_MESSAGE` if missing or not `Active`, and attaches profile to `req.sponsorProfile`. |
| `SponsorProfile.licenceStatus` and `licenceNumber` set on grant | PASS (WARNING) | Both fields are correctly updated by `activateSponsorLicence()`. WARNING: the profile transaction commits before `application.save()` and `LicenceGrantRecord.create()` run, creating a partial-grant inconsistency window. |
| `SponsorProfile` not mutated on licence rejection | PASS | `rejectLicence()` only updates the `LicenceApplication` row; `SponsorProfile` is untouched. |
| `cosAllocation` increment is atomic (inside a transaction with `FOR UPDATE`) | PASS | Wrapped in `tenantDb.sequelize.transaction()` with `lock: transaction.LOCK.UPDATE` on `SponsorProfile`. |
| `activateSponsorLicence()` partial failure leaves `SponsorProfile` inconsistent | FAIL | The inner transaction in `activateSponsorLicence()` commits independently. If the subsequent `application.save()` or `LicenceGrantRecord.create()` fails, the sponsor profile is `Active` with no corresponding grant record and a stale application status. |
| `cosAllocation` cannot go negative from CoS rejection | PASS | Rejection path never decrements `cosAllocation`; no decrement code path exists in the service. |
| `SponsorProfile` has unique constraint on `userId` | PASS | `unique: true` index defined in `sponsorProfile.model.js`. |

---

### 4. CoS Workflow

| Check | Result | Details |
|---|---|---|
| `COS_STATUS` alias consistency with DB string values | PASS (WARNING) | Aliases are internally consistent but `COS_APPROVED = "Allocated"` (not `"Approved"`) is a naming trap for future developers checking intermediate state. |
| `reviewCosRequest()` approve path is fully atomic | PASS (WARNING) | All three mutations run inside one transaction with `FOR UPDATE` on `SponsorProfile`. WARNING: `request.status` is set to `"Approved"` before the transaction begins and is briefly visible to READ COMMITTED readers. |
| `reviewCosRequest()` cannot be called twice on an Allocated request | PASS | `REVIEWABLE` guard returns HTTP 409; `cos_request_id` UNIQUE constraint on `CosAllocationRecord` provides a second layer. |
| Reviewer assignment enforced on CoS actions | PASS (WARNING) | Enforced in `caseworkerCos.controller.js` via `loadReviewable()`. WARNING: enforcement is at the controller layer only; the service itself has no ownership check, so admin and background callers bypass it by design. |
| `allocationNumber` uniqueness guaranteed | PASS | Deterministic generation `EPIC-COS-{year}-{requestId}` plus DB UNIQUE constraint on the column. |

---

### 5. Visa Workflow (Phase 5)

| Check | Result | Details |
|---|---|---|
| Worker can be created without `cosRequestId` or `cosAllocationRecordId` | PASS (WARNING) | Fields are intentionally nullable. WARNING: no CoS budget check is performed at worker creation; over-allocation against available CoS is not prevented. |
| Multiple workers can reference the same `CosAllocationRecord` | FAIL | No UNIQUE constraint on `cosAllocationRecordId` in `sponsoredWorker.model.js`. One allocation record can be linked to unlimited worker rows; quantity enforcement is absent. |
| `Visa Rejected` reachable from all non-terminal stages | PASS | All five active stages list `Visa Rejected` as a valid transition in `WORKER_TRANSITIONS`. |
| `Visa Granted` only reachable from `Visa Decision` | PASS | Matrix strictly enforces the path; all other attempts return HTTP 422. |
| `SponsoredWorkerAudit` rows created for every status change including creation | PASS | All five state-changing functions call `recordWorkerAudit()`; creation writes `fromStatus: null`. |

---

### 6. Route Coverage & Authorisation

| Check | Result | Details |
|---|---|---|
| `admin.licence.routes.js` covers Phases 1–5 | PASS (WARNING) | All phase actions present. WARNING: no single CoS request detail GET endpoint; no admin appendix-document listing route. |
| `caseworker.licence.routes.js` — `ensureAssignedCaseworker` on all mutations | PASS | Every mutation and specific-record read correctly applies the assignment guard. |
| `sponsorLicenceV2.routes.js` — sponsor-side info request coverage | PASS (WARNING) | List, get-single, respond, and comment routes all present. WARNING: this router carries zero auth middleware of its own; all security is delegated to the parent router. |
| `caseworkerCos.routes.js` — CoS action coverage | PASS (WARNING) | All required action routes present. WARNING: approve/reject/request-info routes have no ownership check verifying the caseworker is assigned to the specific CoS request. |
| `admin.worker.routes.js` — Phase 5 endpoint coverage | PASS | All eight required worker endpoints are present. |
| Soft-delete route for `SponsoredWorker` | FAIL | No DELETE or deactivate route exists for `SponsoredWorker`. `LicenceApplication` has both soft-delete and restore; the asymmetry is unaddressed. |
| `POST /:id/grant` and `POST /:id/reject-final` restricted to `ADMIN_ROLES` | PASS | Router-level `checkRole(ADMIN_ROLES)` in `admin.licence.routes.js` covers both routes; caseworker router does not expose them. |
| Auth middleware coverage across all route files | WARNING | `sponsorLicenceV2.routes.js` has no own `verifyTokenAndTenant` or role check — a latent exposure if the router is ever remounted. `caseworkerCos.routes.js` uses an ad-hoc role array rather than the named constant, risking silent divergence. |

---

### 7. Edge Cases & Data Integrity

| Check | Result | Details |
|---|---|---|
| Race condition: two admins simultaneously call `grantLicence` | FAIL | No `SELECT FOR UPDATE` on `LicenceApplication`; both pass `validateTransition`, both run `activateSponsorLicence()` (double expiry write), DB UNIQUE on `LicenceGrantRecord` catches the second insert as an unhandled 500. |
| Race condition: two caseworkers simultaneously approve a CoS request | FAIL | `CosRequest` row is not locked before the guard check; both pass, both enter the transaction; SponsorProfile `FOR UPDATE` prevents double-increment but second `CosAllocationRecord.create()` fires a UNIQUE violation as an unhandled 500. |
| `LicenceApplication.status` ENUM includes `Licence Granted` and `Licence Rejected` | PASS | Both values confirmed in migration `20260616130000` and the Sequelize model. Note: `Draft` is in the model but absent from all migrations. |
| `CosRequest.status` has ENUM or CHECK constraint at DB level | WARNING | Plain `VARCHAR(30)`; valid values enforced by service layer only. |
| `SponsoredWorker.status` has ENUM or CHECK constraint at DB level | FAIL | Plain `VARCHAR(60)` with no CHECK constraint; arbitrary values writable via direct SQL. |
| `activateSponsorLicence()` and `application.save()` in one transaction | FAIL | They are in separate transactions. `SponsorProfile` can be committed as `Active` while application status remains `Decision Pending` if `application.save()` fails. |
| `listCaseworkerWorkers` uses valid PostgreSQL function for JSONB containment | FAIL | Uses `jsonb_contains()` which is not a PostgreSQL built-in. Will throw `function jsonb_contains(jsonb, jsonb) does not exist` at runtime. The `literal()` call also bypasses Sequelize parameterization, introducing a SQL injection surface. |
| `workerEmail` validated as a proper email format on input | FAIL | No format check in `createSponsoredWorker()`; any string up to 255 characters is accepted and stored silently. |

---

## Issues Log

**[CRITICAL] ISSUE-001 — `grantLicence()` has no outer transaction; `SponsorProfile` committed Active before application status is persisted**
_Dimension:_ Business Profile Integration / Edge Cases & Data Integrity
_File(s):_ `src/services/licenceGrant.service.js` (~lines 44–110)
_Description:_ `activateSponsorLicence()` opens and commits its own internal transaction, setting `SponsorProfile.licenceStatus = 'Active'`. After it returns, `application.save()` and `LicenceGrantRecord.create()` execute as separate, uncoordinated writes. There is no wrapping transaction and no compensating rollback.
_Risk:_ If `application.save()` or `LicenceGrantRecord.create()` fails, the sponsor's profile shows Active and they can access Phase 4/5 features (CoS requests gate on `licenceStatus = 'Active'`), but no `LicenceGrantRecord` exists and the application status is stale. The system is in a split, unrecoverable state without manual intervention.
_Fix:_ Refactor `activateSponsorLicence()` to accept an external transaction handle as a parameter. Open one wrapping transaction in `grantLicence()` that covers `activateSponsorLicence()`, `application.save()`, and `LicenceGrantRecord.create()`. Commit only when all three succeed.

---

**[CRITICAL] ISSUE-002 — `listCaseworkerWorkers` calls non-existent PostgreSQL function `jsonb_contains`; also SQL injection via `literal()`**
_Dimension:_ Edge Cases & Data Integrity
_File(s):_ `src/services/sponsoredWorker.service.js` (listCaseworkerWorkers)
_Description:_ The query uses `tenantDb.sequelize.fn("jsonb_contains", ...)`. PostgreSQL has no built-in scalar function named `jsonb_contains`; the standard containment check uses the `@>` operator. This query throws `ERROR: function jsonb_contains(jsonb, jsonb) does not exist` on every execution. Additionally, the value is interpolated via `sequelize.literal()`, bypassing Sequelize parameterization entirely.
_Risk:_ Every caseworker request to list their assigned workers crashes at the database layer, making the entire caseworker worker-management view non-functional. The `literal()` pattern is a SQL injection surface if the coercion guard is ever weakened.
_Fix:_ Replace with `where: { assignedCaseworkerIds: { [Op.contains]: [Number(caseworkerId)] } }`. This compiles to the standard `@>` operator and uses safe parameterization.

---

**[HIGH] ISSUE-003 — Race condition on `grantLicence`: two concurrent admin calls trigger `activateSponsorLicence()` twice and surface a DB constraint violation as HTTP 500**
_Dimension:_ Edge Cases & Data Integrity
_File(s):_ `src/services/licenceGrant.service.js` (~lines 44–94)
_Description:_ No `SELECT FOR UPDATE` on the `LicenceApplication` row is taken before `validateTransition`. Two concurrent requests both see status `Decision Pending`, both pass the check, and both execute `activateSponsorLicence()`. The second `LicenceGrantRecord.create()` hits the UNIQUE constraint and throws an uncaught `UniqueConstraintError`, returning HTTP 500.
_Risk:_ `activateSponsorLicence()` runs twice: the licence expiry date is recalculated from `now()` on each call, so the second execution extends the expiry. The caller receives a 500 with no diagnostic information. There is no rollback of the double write to `SponsorProfile`.
_Fix:_ Open the outer grant transaction (see ISSUE-001) with an explicit `SELECT ... FOR UPDATE` on the `LicenceApplication` row before calling `validateTransition`. Catch `UniqueConstraintError` on `LicenceGrantRecord.create()` and return HTTP 409 with a meaningful message.

---

**[HIGH] ISSUE-004 — Race condition on `reviewCosRequest` approve: `CosRequest` row not locked; DB constraint violation surfaces as HTTP 500**
_Dimension:_ Edge Cases & Data Integrity / CoS Workflow
_File(s):_ `src/services/cosRequest.service.js` (~lines 272–360)
_Description:_ The `REVIEWABLE` guard check and the subsequent `request.status` mutation occur before the transaction begins and without a row lock on `CosRequest`. Two concurrent callers both see status `Under Review`, both pass the guard, and both enter the transaction. The `SponsorProfile` `FOR UPDATE` lock prevents a double `cosAllocation` increment, but both callers attempt `CosAllocationRecord.create()`; the second throws a UNIQUE violation as HTTP 500.
_Risk:_ The second request gets an unhelpful 500 rather than a 409. Partial audit entries may be written. The API surface is inconsistent with every other conflict scenario in the codebase.
_Fix:_ Move `CosRequest.findByPk(id)` inside the transaction with `lock: transaction.LOCK.UPDATE`. Re-check `REVIEWABLE.includes(request.status)` after acquiring the lock before proceeding.

---

**[HIGH] ISSUE-005 — `reviewCosRequest()` bypasses `validateTransition` entirely; FSM matrix not consulted for any CoS status change**
_Dimension:_ Stage Skipping & Status Transitions
_File(s):_ `src/services/cosRequest.service.js` (~lines 272–360)
_Description:_ `reviewCosRequest()` uses only an inline `REVIEWABLE` array check rather than delegating to `validateTransition`. `assignCosRequest()` hard-codes `status = COS_STATUS.UNDER_REVIEW` with no FSM call. The `COS_REQUEST_TRANSITIONS` matrix in `workflowEngine.service.js` is never consulted for any CoS workflow operation.
_Risk:_ Any future change to the CoS transitions matrix has no effect on runtime behaviour. The FSM and the service are silently diverged. Unauthorized transitions could be introduced by modifying the service without updating the matrix, with no engine-level enforcement catching the discrepancy.
_Fix:_ Replace the `REVIEWABLE` inline check and the hard-coded `UNDER_REVIEW` assignment with calls to `validateTransition(WORKFLOW_TYPES.COS_REQUEST, request.status, newStatus)`. Remove the duplicate `REVIEWABLE` constant.

---

**[HIGH] ISSUE-006 — `activateSponsorLicence()` is triggerable from three independent controller paths; double-execution not guarded at the application layer**
_Dimension:_ Duplicate Task Creation & Orphan Tasks
_File(s):_ `src/modules/Admin/Settings/licenceManagement.controller.js:194`, `src/modules/Caseworker/Cases/caseworkerLicence.controller.js:92`, `src/services/licenceGrant.service.js:62`
_Description:_ An admin calling `updateLicenceApplicationStatus` with `status = "Approved"` triggers `activateSponsorLicence()`. A caseworker approving via their route triggers it independently. An admin subsequently calling `POST /:id/grant` triggers it a third time. No application-layer idempotency guard prevents multiple executions.
_Risk:_ Licence expiry dates can be overwritten on each call. The combined `"Approved" → grant` flow causes a second `LicenceGrantRecord.create()` that throws an unhandled 500. Stage tasks are seeded redundantly (harmless but wasteful).
_Fix:_ Add an idempotency guard in `activateSponsorLicence()`: check `profile.licenceStatus === 'Active'` at entry and return early with `wasActive: true` without re-executing any writes. Consolidate the activation trigger to the `grantLicence()` path only; remove the activation call from `updateLicenceApplicationStatus` and the caseworker controller, or explicitly gate it so it never fires on a profile already Active.

---

**[HIGH] ISSUE-007 — `sponsorLicence.controller.js` performs unauthorized `Information Requested → Pending` status mutation bypassing the FSM**
_Dimension:_ Stage Skipping & Status Transitions
_File(s):_ `src/modules/Sponsor/Licence/sponsorLicence.controller.js` (~line 168)
_Description:_ The sponsor update endpoint writes `updateData.status = 'Pending'` and calls `application.update(updateData)` while the application is in `Information Requested` state, with no call to `validateTransition`. The `Information Requested → Pending` transition is not defined in `LICENCE_TRANSITIONS` (the matrix specifies `Information Requested → [Under Review, Rejected]`).
_Risk:_ A sponsor can silently push any application from `Information Requested` back to `Pending` by editing any application field, bypassing the formal `Under Review` re-entry step and all associated audit/notification pipeline steps.
_Fix:_ Remove the auto-status override from the sponsor update function. Status transitions must originate from staff-facing controllers that call `validateTransition`. If the intent is to re-queue for review on sponsor edit, introduce an explicit `Information Requested → Under Review` call via the workflow engine.

---

**[HIGH] ISSUE-008 — `LicenceGrantRecord.create()` not wrapped in a try/catch; `UniqueConstraintError` surfaces as HTTP 500**
_Dimension:_ Duplicate Task Creation & Orphan Tasks
_File(s):_ `src/services/licenceGrant.service.js` (~line 94)
_Description:_ There is no application-layer pre-check for an existing `LicenceGrantRecord` before calling `create()`. The DB UNIQUE constraint is the only guard, and the resulting `UniqueConstraintError` is not caught, propagating as an unhandled 500.
_Risk:_ Any duplicate grant attempt — whether from a race condition, an admin retrying, or the three-path activation scenario — presents a confusing internal server error to the caller with no actionable message.
_Fix:_ Wrap `LicenceGrantRecord.create()` in a try/catch that specifically catches `UniqueConstraintError` and throws an HTTP 409 with the message "A grant record already exists for this application." Alternatively, use `findOrCreate` to make the operation idempotent.

---

**[MEDIUM] ISSUE-009 — Multiple workers can reference the same `CosAllocationRecord`; over-allocation not prevented**
_Dimension:_ Visa Workflow (Phase 5)
_File(s):_ `src/models/tenant/sponsoredWorker.model.js`, `src/services/sponsoredWorker.service.js` (createSponsoredWorker)
_Description:_ `cosAllocationRecordId` in `sponsoredWorker.model.js` is a nullable FK with no UNIQUE constraint. Multiple `SponsoredWorker` rows can reference the same `CosAllocationRecord`. `createSponsoredWorker()` performs no check against the allocated quantity.
_Risk:_ A sponsor with an allocation for 5 CoS certificates could create an unlimited number of worker records against that same allocation record. CoS budget enforcement is completely absent at the worker-creation layer.
_Fix:_ At worker creation, query the count of existing `SponsoredWorker` rows referencing the same `cosAllocationRecordId` and compare against `CosAllocationRecord.allocatedAmount`. Reject creation if the count is already at the limit. Optionally add a DB-level check for single-worker allocations.

---

**[MEDIUM] ISSUE-010 — `SponsoredWorker.status` is a plain `VARCHAR(60)` with no DB-level ENUM or CHECK constraint**
_Dimension:_ Edge Cases & Data Integrity
_File(s):_ Migration `20260616150000`, `src/models/tenant/sponsoredWorker.model.js`
_Description:_ The status column uses `VARCHAR(60)` with no CHECK constraint and no Postgres ENUM. Valid statuses are enforced only through the `WORKER_TRANSITIONS` FSM matrix at the service layer.
_Risk:_ A direct SQL write, an admin script, or a future service that bypasses `validateTransition` can store an arbitrary string. Downstream reads filtering on status values would silently misclassify the worker.
_Fix:_ Add a Postgres CHECK constraint in a new migration: `CHECK (status IN ('CoS Assigned', 'Immigration Assessment', 'Visa Preparation', 'Compliance Review', 'Visa Decision', 'Visa Granted', 'Visa Rejected'))`.

---

**[MEDIUM] ISSUE-011 — No email format validation for `workerEmail` in `createSponsoredWorker()`**
_Dimension:_ Edge Cases & Data Integrity
_File(s):_ `src/services/sponsoredWorker.service.js` (createSponsoredWorker)
_Description:_ `workerEmail` is stored as-is after only a `?.trim()` call. No regex or library-based format check is applied. The DB column is `VARCHAR(255)` with no CHECK constraint.
_Risk:_ Malformed email addresses are stored silently and fail only at the SMTP layer when notification or credential-sending flows attempt delivery, producing silent failures with no useful error surfaced to the operator.
_Fix:_ When `workerEmail` is provided (it is optional), validate it against a standard email pattern (e.g., `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` or `validator.js isEmail()`). Throw HTTP 400 with a clear message if the format is invalid.

---

**[MEDIUM] ISSUE-012 — `sponsorLicenceV2.routes.js` has no auth middleware of its own; security depends entirely on parent router**
_Dimension:_ Route Coverage & Authorisation
_File(s):_ `src/modules/Sponsor/Licence/sponsorLicenceV2.routes.js`
_Description:_ The router file contains zero calls to `verifyTokenAndTenant` or `checkRole`. All authentication and authorisation is inherited from the parent router's mounting point. Other router files apply auth at the router level as a defence-in-depth measure.
_Risk:_ If this router is ever remounted in a different context, or if the parent middleware chain is conditionally modified, all sponsor licence endpoints — including application submission and deletion — become publicly accessible without any authentication.
_Fix:_ Add `router.use(verifyTokenAndTenant)` and `router.use(checkRole([ROLES.BUSINESS]))` at the top of `sponsorLicenceV2.routes.js`, consistent with the pattern used in other route files.

---

**[LOW] ISSUE-013 — Legacy `Pending → Approved` and `Decision Pending → Approved` transitions create a dead-end branch that partially activates a licence without a `Licence Granted` record**
_Dimension:_ Stage Skipping & Status Transitions
_File(s):_ `src/services/workflowEngine.service.js` (LICENCE_TRANSITIONS), `src/modules/Admin/Settings/licenceManagement.controller.js`
_Description:_ The `LICENCE_TRANSITIONS` matrix lists `Approved` as a valid next state from both `Pending` and `Decision Pending`. `Approved` leads only to `Expired` and has no path to `Licence Granted`. `activateSponsorLicence()` fires when status reaches `Approved` (via `licenceManagement.controller.js:194`), partially activating the licence without a formal grant record.
_Risk:_ An administrator can move an application to `Approved` via the generic status-update endpoint, triggering `activateSponsorLicence()` and making the sponsor's licence appear Active, while the application is in a state from which `Licence Granted` is unreachable. The application is permanently stranded.
_Fix:_ Remove `Approved` from the allowed-next-states of `Pending` and `Decision Pending` in the LICENCE_TRANSITIONS matrix, or explicitly document and route the `Approved` state as a deprecated V1 path that does not trigger `activateSponsorLicence()`.

---

**[LOW] ISSUE-014 — `caseworkerCos.routes.js` approve/reject/request-info routes lack caseworker ownership check**
_Dimension:_ Route Coverage & Authorisation
_File(s):_ `src/modules/Caseworker/Cos/caseworkerCos.routes.js`
_Description:_ The mutation routes apply only a role check (`CASEWORKER` or `ADMIN`). Any user with either role can act on any CoS request ID, not only those assigned to them. This contrasts with `caseworker.licence.routes.js`, which uses `ensureAssignedCaseworker()` on all mutations.
_Risk:_ A caseworker can approve or reject CoS requests that were assigned to a different caseworker. This violates the principle of assignment-scoped authority and creates an audit trail inconsistency.
_Fix:_ Add an ownership-check middleware before each mutation route in `caseworkerCos.routes.js` that verifies the authenticated caseworker is listed in `assignedCaseworkerIds` of the target `CosRequest`, or has a full-access role.

---

**[WARNING] ISSUE-015 — `licenceInformationRequest.service.js` directly writes `Under Review` status without invoking the workflow engine**
_Dimension:_ Stage Skipping & Status Transitions
_File(s):_ `src/services/licenceInformationRequest.service.js` (~line 299, closeInfoRequest)
_Description:_ The service calls `application.update({ status: "Under Review" })` directly, bypassing `executeWorkflowTransition`. The destination status is valid per the matrix, and `recordLicenceAudit` and `licenceStatusChanged` are called manually, but the write is structurally inconsistent with all other transition points.
_Risk:_ Any future side-effects wired into `executeWorkflowTransition` (e.g., timeline entries, webhooks, additional notifications) will not fire on this code path, creating silent feature gaps.
_Fix:_ Replace the direct `application.update()` call with `executeWorkflowTransition(WORKFLOW_TYPES.LICENCE, application, "Under Review", actorId)` to route the transition through the engine consistently.

---

**[WARNING] ISSUE-016 — `COS_APPROVED` alias resolves to `"Allocated"`, not `"Approved"`, creating a naming trap**
_Dimension:_ CoS Workflow
_File(s):_ `src/services/cosRequest.service.js` (COS_STATUS constants)
_Description:_ `COS_STATUS.COS_APPROVED = "Allocated"`. The intermediate `"Approved"` string exists in the DB transiently during the approval transaction but is never exposed as a named constant. A developer checking `status === COS_STATUS.COS_APPROVED` to detect an approved-but-not-yet-allocated request will get a false negative.
_Risk:_ Future developers writing status checks or reporting queries using the named constant will silently miss requests in the intermediate `"Approved"` state.
_Fix:_ Rename `COS_APPROVED` to `COS_ALLOCATED` and add a separate `COS_APPROVED = "Approved"` constant, or add a prominent comment explaining that `COS_APPROVED` represents the final allocated state and that the intermediate `"Approved"` state is a transient implementation detail.

---

**[WARNING] ISSUE-017 — `CosRequest.status` has no DB-level CHECK constraint; valid values enforced by service layer only**
_Dimension:_ Edge Cases & Data Integrity
_File(s):_ Migration `20260610150000`
_Description:_ Status is `VARCHAR(30)` with no CHECK constraint or Postgres ENUM. The five valid values are enforced only by the `COS_REQUEST_TRANSITIONS` matrix and the `REVIEWABLE` guard, both of which are already confirmed to be inconsistently applied (ISSUE-005).
_Risk:_ Given that the FSM is already bypassed for CoS (ISSUE-005), there is no DB-level fallback preventing an invalid string from being written.
_Fix:_ Add a migration that introduces a CHECK constraint: `CHECK (status IN ('Pending', 'Under Review', 'Approved', 'Rejected', 'Allocated'))`.

---

**[WARNING] ISSUE-018 — `Draft` status present in `LicenceApplication` Sequelize model but absent from all migrations**
_Dimension:_ Stage Skipping & Status Transitions / Edge Cases & Data Integrity
_File(s):_ `src/models/tenant/licenceApplication.model.js`, migrations `20260428120000`–`20260616130000`
_Description:_ The Sequelize model enumerates `'Draft'` as a valid ENUM value, but no migration has added it to `enum_licence_applications_status` in Postgres. Attempting to persist `status = 'Draft'` will raise a Postgres ENUM violation at runtime.
_Risk:_ Any code path that references `LICENCE_STATUS.DRAFT` or similar will fail at runtime with an opaque DB error. The FSM also has no `Draft` entry, so any such row would be permanently unroutable.
_Fix:_ Either add a migration to insert `'Draft'` into the Postgres ENUM and add a corresponding entry in `LICENCE_TRANSITIONS`, or remove `'Draft'` from the Sequelize model enum list to align model and database schema.

---

## Passing Checks Summary

- `ensureStageTasks()` uses `findOrCreate` exclusively; no bare `.create()` for `LicenceStageTask`.
- UNIQUE constraint on `(licenceApplicationId, stageKey, role)` enforced at both model and migration level.
- `ensureStageTasks()` is idempotent on repeated calls; break-on-first-incomplete logic is correct.
- `LicenceStageTask` rows cascade-delete on `LicenceApplication` hard-delete; soft-delete correctly retains child rows.
- `CosAllocationRecord` cascade-deletes on `CosRequest` hard-delete.
- `SponsoredWorkerAudit` rows cascade-delete on `SponsoredWorker` hard-delete.
- Worker stage skip (`CoS Assigned → Visa Preparation`) is correctly blocked by `validateTransition` with HTTP 422.
- `licenceGrant.service.js` `grantLicence()` calls `validateTransition` with `roleId` before any mutation.
- `licenceGrant.service.js` `rejectLicence()` calls `validateTransition` before any mutation.
- `sponsoredWorker.service.js` — all state-changing functions call `validateTransition`; initial creation is a valid exempt entry point.
- `requireActiveSponsorLicence` middleware correctly checks `licenceStatus`, attaches profile to `req.sponsorProfile`, and returns HTTP 403 with `INACTIVE_LICENCE_MESSAGE`.
- `SponsorProfile.licenceStatus` and `sponsorLicenceNumber` are both set on licence grant.
- `SponsorProfile` is correctly not mutated on licence rejection.
- `cosAllocation` increment is atomic with `SELECT FOR UPDATE` on `SponsorProfile`.
- `cosAllocation` cannot go negative through the CoS rejection code path.
- `SponsorProfile` has a UNIQUE index on `userId` at both model and database level.
- `reviewCosRequest()` double-approve is blocked by HTTP 409 plus `CosAllocationRecord` UNIQUE constraint.
- `allocationNumber` uniqueness is guaranteed by deterministic generation and a DB UNIQUE constraint.
- `Visa Rejected` is reachable from all five non-terminal worker stages via the FSM matrix.
- `Visa Granted` is only reachable from `Visa Decision`; all other paths return HTTP 422.
- `SponsoredWorkerAudit` rows are written for every status change, including worker creation (`fromStatus: null`).
- `caseworker.licence.routes.js` applies `ensureAssignedCaseworker()` correctly on all mutations.
- `POST /:id/grant` and `POST /:id/reject-final` are restricted to `ADMIN_ROLES` via router-level middleware.
- All eight Phase 5 worker endpoints are present in `admin.worker.routes.js`.
- `LicenceApplication.status` ENUM contains both `Licence Granted` and `Licence Rejected` (confirmed in migration `20260616130000`).

---

## Recommendations

**1. Wrap `grantLicence()` in a single database transaction (addresses ISSUE-001, ISSUE-003, ISSUE-008)**
This is the highest-priority change. Refactor `activateSponsorLicence()` to accept an external Sequelize transaction handle. In `grantLicence()`, open one transaction that covers `activateSponsorLicence()`, `application.save()`, and `LicenceGrantRecord.create()`. Begin the transaction with `SELECT ... FOR UPDATE` on the `LicenceApplication` row. Catch `UniqueConstraintError` on `LicenceGrantRecord.create()` and return HTTP 409. This eliminates the split-state risk, the race condition, and the unhandled 500 in a single change.

**2. Fix the `jsonb_contains` crash in `listCaseworkerWorkers()` (addresses ISSUE-002)**
This is a runtime defect that makes the entire caseworker worker-management view non-functional today. Replace the `sequelize.fn("jsonb_contains", ...)` / `literal()` pattern with `{ assignedCaseworkerIds: { [Op.contains]: [Number(caseworkerId)] } }`. Deploy immediately.

**3. Route all CoS status mutations through `validateTransition` (addresses ISSUE-005, ISSUE-017)**
Remove the `REVIEWABLE` inline array from `cosRequest.service.js` and replace both `reviewCosRequest()` and `assignCosRequest()` with calls to `validateTransition(WORKFLOW_TYPES.COS_REQUEST, ...)`. Follow this with a migration that adds a CHECK constraint on `cos_requests.status`. This ensures the FSM matrix is the single source of truth for all three workflow types.

**4. Add an idempotency guard to `activateSponsorLicence()` and consolidate its call sites (addresses ISSUE-006, ISSUE-013)**
Add a guard at the entry of `activateSponsorLicence()` that returns early if `profile.licenceStatus === 'Active'`. Remove the `activateSponsorLicence()` call from `updateLicenceApplicationStatus` and `caseworkerLicence.controller.js`; the activation should originate exclusively from the `grantLicence()` code path. Simultaneously, remove `Approved` from the LICENCE_TRANSITIONS matrix's allowed-next-states for `Pending` and `Decision Pending` to eliminate the dead-end legacy branch.

**5. Add defence-in-depth auth to `sponsorLicenceV2.routes.js` and ownership checks to `caseworkerCos.routes.js` (addresses ISSUE-012, ISSUE-014)**
Add `router.use(verifyTokenAndTenant)` and `router.use(checkRole([ROLES.BUSINESS]))` directly in `sponsorLicenceV2.routes.js`. Add an assignment-ownership middleware to the three mutation routes in `caseworkerCos.routes.js` that rejects requests where the authenticated caseworker is not listed in `assignedCaseworkerIds` for the target CoS request. These are low-effort changes that close meaningful authorisation gaps.
