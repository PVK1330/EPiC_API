# Sponsor Licence — Stages, Tasks & Notifications: Complete Flow

_Last updated: 2026-06-11_

This document describes everything implemented for the sponsor‑licence review
experience in this work stream: the **Admin Licence Requests** panel fixes, the
**authenticated document preview/download**, and the centrepiece — the dynamic
**Stage‑Task engine** that assigns a task to the responsible person at every
lifecycle stage and fires **in‑app + email** notifications on every event.

---

## 0. TL;DR

- The 8‑section UK Visas & Immigration "Apply for a sponsor licence" form is
  modelled as a **10‑stage lifecycle**. Each stage carries one task per role:
  **Sponsor, Caseworker, Admin, Candidate**.
- A new table `licence_stage_tasks` holds one row per `(application, stage, role)`.
- Tasks are **auto‑seeded and assigned** to real people when an application is
  submitted / assigned / changes status. The responsible role can **mark their
  task complete**, which notifies the other parties (in‑app + email) and writes
  an audit row.
- The stage **timeline is data‑driven** (reflects where the application actually
  is); the per‑role **task ticks** reflect who has acted.
- Visible to all four roles (Admin, Caseworker, Sponsor; Candidate by email).

---

## 1. The 10 stages × 4 roles matrix

Source of truth: `Server/src/services/licenceStageTask.service.js`
(`LICENCE_STAGE_DEFINITIONS`) and the mirror in
`EPiC_Frontend/src/constants/licenceStages.js`.

| # | Stage (gov section) | Sponsor | Caseworker | Admin | Candidate |
|---|---|---|---|---|---|
| 1 | Enquiry & Onboarding (Intake) | Submit enquiry | Acknowledge & schedule intro | Triage + assign caseworker | Register interest |
| 2 | Licence Routes (§1) | Choose route(s) + declare SLN | Advise/confirm eligibility | Verify routes recorded | Confirm role/route |
| 3 | Organisation Details (§2) | Provide org / CH / HMRC / PAYE | Verify vs CH & HMRC | QA org profile | — |
| 4 | CoS & CAS (§3) | State CoS count + justification | Validate SOC/salary/genuine vacancy | Approve allocation | Provide role/salary & visa status |
| 5 | Supporting Documents (§4) | Upload Appendix A docs | Review + request missing | Sign off doc pack | Provide passport / visa / BRP |
| 6 | Key Personnel (§5) | Nominate AO/KC/Level‑1; declare convictions | Verify personnel | Approve appointments | — |
| 7 | Declarations (§6) | Confirm true + authorise rep | Complete OISC declaration | Counter‑sign | — |
| 8 | Payment (§7) | Pay fee | Verify payment cleared | Record payment / receipt | — |
| 9 | Submission (§8) | Acknowledge submission | Generate sheet + submit to UKVI | Final authorise | Notified of submission |
| 10 | UKVI Decision & Activation | Receive licence; assign CoS | Coordinate UKVI requests | Record decision + activate | Receive CoS → visa |

Stages 3, 6, 7, 8 have **no candidate task** (→ 36 task rows per application, not 40).

---

## 2. Data model

### New table: `licence_stage_tasks`
Migration: `Server/src/migrations/tenants/20260613120000-create-licence-stage-tasks.sql`
Model: `Server/src/models/tenant/licenceStageTask.model.js`

| Column | Type | Purpose |
|---|---|---|
| `id` | serial PK | |
| `licence_application_id` | FK → `licence_applications` (CASCADE) | owning application |
| `organisation_id` | FK → `organisations` (SET NULL) | tenant org |
| `stage_key` | varchar(50) | e.g. `cos_requirements` |
| `stage_order` | int | 1–10 |
| `role` | varchar(20) | `sponsor` / `caseworker` / `admin` / `candidate` |
| `title` | text | the task text |
| `description` | text | stage title |
| `assigned_to_user_id` | FK → `users` (SET NULL) | the responsible person (null for candidate) |
| `assignee_name`, `assignee_email` | varchar | snapshot (used for candidate email) |
| `status` | varchar(20) | `pending` / `in_progress` / `completed` / `blocked` |
| `completed_at`, `completed_by_user_id` | | completion audit |
| `due_date`, `metadata` | | optional |
| `created_at`, `updated_at` | timestamptz | |
| **UNIQUE** | `(licence_application_id, stage_key, role)` | makes seeding idempotent |

Associations (in `tenantModels.js`): `LicenceApplication hasMany LicenceStageTask`;
`LicenceStageTask belongsTo User as assignee / completedBy`.

> **Migration status:** applied to all 5 tenant databases via `npm run migrate:tenants`.

---

## 3. Role → person resolution

`resolveRoleRecipients(tenantDb, application)` in the engine:

| Role | Resolved from | Notes |
|---|---|---|
| Sponsor | `application.userId` → `User` | the application owner |
| Caseworker | `extractCaseworkerIds(application.assignedcaseworkerId)` → `User[]` | JSONB array; primary = first |
| Admin | first `User` with `role_id = ADMIN` (active first) | the tenant admin |
| Candidate | first `LicenceCosRequirement.candidateName/candidateEmail` | **free‑text, not a portal user** |

> **Architecture:** the platform is **database‑per‑tenant** (`getTenantDb(databaseName)`),
> so a `req.tenantDb` already contains exactly one organisation's data. There is
> no cross‑tenant query risk; org filters are unnecessary inside a tenant DB.

---

## 4. Backend lifecycle flow

### 4.1 Seeding & assignment (`ensureStageTasks`)
Idempotent (`findOrCreate` on the unique key). For each `(stage, role)`:
- resolves the assignee and snapshots name/email,
- sets the initial status from the application's own data (see §4.3),
- **fills/refreshes assignees** on later calls (e.g. when a caseworker is assigned),
- **never un‑completes** a completed task,
- each row is wrapped in its own `try/catch` so one DB error can't abort the batch.

**Called from (best‑effort, non‑blocking — wrapped in try/catch):**
- Sponsor **submit** → `sponsorLicenceV2.controller.submitApplication`
- Admin **assign caseworker** → `licenceManagement.controller.assignCaseworker`
- Admin **status change** (approve/reject/info) → `licenceManagement.controller.updateLicenceApplicationStatus`
- Caseworker **review decision** → `caseworkerLicence.controller.updateLicenceReviewStatus`
- Lazily, on **any stage read** (`getStagesForApplication`) — this makes the panel self‑healing if a seed ever failed.

### 4.2 Reading the panel (`getStagesForApplication`)
Returns `{ applicationId, status, currentStageKey, stages: [{ key, order, title, govSection, status, tasks: [{ role, title, status, assigneeName, assigneeEmail, completedAt }] }] }`.

### 4.3 Stage status vs task status (the important distinction)
- **Stage status is DATA‑DRIVEN** (`deriveStageCompletion`) — it reflects whether
  the underlying data for that stage exists (routes chosen, org filled, CoS added,
  docs verified, AO present, declaration signed, fee/submitted, approved). So the
  timeline always shows where the application actually is.
- **Task status is PER‑ROLE.** A stage's data signal only **auto‑completes the
  data‑provider roles** (Sponsor + Candidate). **Caseworker and Admin review tasks
  stay actionable** until explicitly ticked. When the licence is **Approved**, all
  tasks are genuinely complete.

  _Verified:_ on an `Under Review` app the `submission` stage shows
  `sponsor=completed, candidate=completed, caseworker=pending, admin=pending`.

### 4.4 Completing a task (`completeStageTask`)
1. Authorisation: the actor's role must match the task role, **or** the actor is an
   Admin (admins can complete any role, incl. completing a candidate task on their
   behalf). Sponsors are additionally restricted to their own application.
2. Marks the row `completed` + records `completed_by_user_id` (idempotent).
3. Fires `notifyStageTaskCompleted` (see §5).

---

## 5. Notifications — in‑app + email on every event

All notifications fan out through the existing `sponsorshipNotification.deliver()`
helper → **(1) in‑app** (`notifyUser`, persisted + Socket.IO), **(2) email**
(`sendTransactionalEmail` with the branded template), **(3) audit log**.

| Event | Who is notified (in‑app + email) | Where |
|---|---|---|
| Licence **submitted** | Sponsor (confirm) + Admins (in‑app) | `licenceSubmitted` (pre‑existing) |
| Caseworker **assigned** | Caseworker(s) + Sponsor | `licenceAssigned` (pre‑existing) |
| **Information requested** | Sponsor | `informationRequested` (pre‑existing) |
| **Approved** (activation) | Sponsor | `activateSponsorLicence` (pre‑existing) |
| **Rejected** | Sponsor | `licenceRejected` (pre‑existing) |
| Status change (caseworker) | Sponsor + Admins | `licenceStatusChanged` (pre‑existing) |
| **Stage task completed** *(new)* | Admin + Sponsor + assigned Caseworkers (in‑app + email); **Candidate by email** | `notifyStageTaskCompleted` |

Notes:
- The actor is never notified about their own action.
- The **audit row is written exactly once** per completion, independent of the
  notification fan‑out.
- Seeding/auto‑completion is **silent** (no notification) — the triggering status
  change already sends its own notification, so this avoids notification storms.

---

## 6. API endpoints

Stage panel (role‑aware, same shape on each router):

| Method | Path | Role / guard |
|---|---|---|
| GET | `/api/admin/licence/:id/stages` | Admin (`checkRole`) |
| POST | `/api/admin/licence/:id/stages/:stageKey/complete` | Admin |
| GET | `/api/caseworker/licence/:id/stages` | assigned caseworker / admin (`ensureAssignedCaseworker`) |
| POST | `/api/caseworker/licence/:id/stages/:stageKey/complete` | assigned caseworker / admin |
| GET | `/api/business/licence/v2/applications/:id/stages` | owning sponsor (BUSINESS + ownership check) |
| POST | `/api/business/licence/v2/applications/:id/stages/:stageKey/complete` | owning sponsor |

Shared controller: `Server/src/modules/Shared/Licence/licenceStage.controller.js`
(`getLicenceStages`, `completeLicenceStageTask`). Complete payload: `{ role }`.

### Related endpoint added earlier in this stream
| GET | `/api/admin/licence/:id/documents/:index/download` | Streams a licence document through an authenticated endpoint (static `/uploads` serving was disabled). Inline preview for pdf/images, attachment otherwise; path confined to `storage/private`. |

---

## 7. Frontend

| File | Role |
|---|---|
| `EPiC_Frontend/src/constants/licenceStages.js` | stage definitions, role chips, `deriveStageStatuses` (static fallback) |
| `EPiC_Frontend/src/components/licence/LicenceStages.jsx` | the interactive panel |
| `EPiC_Frontend/src/services/licenceStageApi.js` | role‑aware `getLicenceStages` / `completeLicenceStageTask` |
| `EPiC_Frontend/src/components/licence/LicenceApplicationV2Detail.jsx` | **Admin + Caseworker** host (`/admin/licence/v2/:id`, `/caseworker/licence/v2/:id`) |
| `EPiC_Frontend/src/pages/business/LicenceProcess.jsx` | **Sponsor** host (fetches their latest V2 app) |

Panel behaviour:
- Fetches live stages when an `applicationId` is present; renders a vertical
  timeline (done / in‑progress / pending / rejected) with a progress bar.
- Each stage expands to show the four role tasks with assignee names and a
  **"Mark complete"** button on the viewer's own task (Admins can complete any;
  candidate tasks are admin‑only since the candidate has no login).
- Completing calls the API, refreshes from the server response, and shows a toast.
- Robust states: loading spinner, **error card with retry**, and a **"No
  application yet"** empty state.

---

## 8. End‑to‑end walkthrough (concrete)

1. **Sponsor submits** the V2 application → status `Pending`.
   - `licenceSubmitted` notifies the sponsor (in‑app+email) and admins (in‑app).
   - `ensureStageTasks` seeds 36 task rows; sponsor/candidate data tasks for
     completed stages are marked done; reviewer tasks are `pending`.
2. **Admin assigns a caseworker** → status `Under Review`.
   - `licenceAssigned` notifies the caseworker(s) + sponsor.
   - `ensureStageTasks` sets the caseworker as assignee on the caseworker tasks.
3. **Caseworker opens** `/caseworker/licence/v2/:id` → sees the timeline at the
   current stage and their pending tasks; ticks "Review each document".
   - `completeStageTask` → admin + sponsor get an in‑app + email update; audit row.
4. **Admin approves** → `activateSponsorLicence` notifies the sponsor; the licence
   activates; `ensureStageTasks` marks all stages/tasks complete (terminal).

---

## 9. Verification performed

- Tenant migration ran on all 5 databases; `licence_stage_tasks` confirmed present.
- Backend modules import cleanly (no circular deps); all syntax‑checked.
- Runtime engine test on a real **Approved** app → 36 tasks, correct assignees,
  all stages complete.
- Runtime engine test on a synthetic **Under Review** app → data‑driven timeline
  with `current = cos_requirements`, and reviewer tasks correctly `pending` while
  sponsor/candidate tasks auto‑complete; temp data cleaned up.
- Frontend `eslint` clean (new files) and **production build passes**.
- Adversarial multi‑agent review (24 agents, 17 confirmed findings): 8 real issues
  fixed; 9 rejected with reasoning (org‑scoping false‑positives that would break on
  a `database‑per‑tenant` model, notify‑on‑auto‑complete spam, redundant fail‑on‑seed).

---

## 10. Operational notes

- **Restart the API server** to load the new model registration, routes, service
  and controller hooks. (The DB migration has already been applied.)
- New tenants: the migration runs automatically with `npm run migrate:tenants`.

## 11. Known limitations / possible next steps

- **Candidate** is a free‑text CoS contact (no portal user): candidate tasks are
  completed by an admin and the candidate is reached by **email only**. A dedicated
  candidate licence view would require linking a candidate `User` to the CoS row.
- Task completion currently has no "undo"; add a reopen endpoint if needed.
- Due dates / SLA reminders are modelled (`due_date`) but not yet auto‑populated.
- Stage definitions live in two places (backend service + frontend constants) kept
  in sync by hand; could be served from one endpoint if drift becomes a concern.
