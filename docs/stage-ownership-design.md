# Stage Ownership Design

## Purpose

Every stage in the 18-stage Sponsor Licence pipeline has a single *owner* at any point in time — the person whose task is currently awaiting action. This document describes how ownership is derived, how SLA deadlines are computed, and how visibility is role-gated in the UI.

---

## Ownership Model

Ownership is derived directly from the **task chain** already in the DB (`licence_stage_tasks`). No separate ownership table is needed.

### Algorithm

1. For the given stage, walk the within-stage role execution order (`stageRoleOrder(stageKey)`).
2. The first task row whose `status` is `"pending"` or `"in_progress"` is the *active task*.
3. That task's `role` is the **Current Owner**; its `assigneeName` and `assignedToUserId` identify the **Assigned To** person.

```
stage.currentOwner        = firstActive.role
stage.currentAssigneeName = firstActive.assigneeName
stage.waitingSince        = firstActive.createdAt   (when the task was seeded)
stage.dueDate             = firstActive.dueDate      (seed time + SLA days)
stage.slaStatus           = computeSlaStatus(firstActive.dueDate)
```

If no active task exists (stage complete, or all tasks locked), all fields are `null`.

---

## SLA (Service Level Agreement)

### SLA Days Per Stage

| Stage | Key | SLA (days) |
|---|---|---|
| 1 | enquiry_onboarding | 3 |
| 2 | licence_routes | 5 |
| 3 | organisation_details | 5 |
| 4 | cos_requirements | 5 |
| 5 | supporting_documents | 7 |
| 6 | key_personnel | 5 |
| 7 | declarations | 3 |
| 8 | payment | 5 |
| 9 | intake_information_form | 5 |
| 10 | intake_document_checklist | 7 |
| 11 | sponsor_information_provision | 5 |
| 12 | government_sms_registration | 7 |
| 13 | sponsor_portal_onboarding | 3 |
| 14 | government_portal_credentials | 5 |
| 15 | government_application_forms | 7 |
| 16 | government_submission | 3 |
| 17 | submission | 5 |
| 18 | decision_activation | 60 |

SLA clocks start **when the task is seeded** (i.e. when it becomes the assignee's turn). `dueDate = seedTime + SLA_DAYS`.

### Traffic-Light Status (`slaStatus`)

| Value | Condition |
|---|---|
| `green` | `dueDate > now + 2 days` |
| `amber` | `0 < dueDate ≤ now + 2 days` (due within 2 days) |
| `red` | `dueDate < now` (overdue) |
| `null` | Task completed, locked, or no due date set |

---

## API Response Shape

`GET /stages` (any role) adds the following fields to each stage object:

```json
{
  "key": "supporting_documents",
  "order": 5,
  "title": "Supporting Documents",
  "govSection": "Section 4",
  "status": "in_progress",
  "tasks": [ ... ],
  "currentOwner":        "caseworker",
  "currentAssigneeName": "Jane Smith",
  "waitingSince":        "2026-06-14T09:00:00.000Z",
  "dueDate":             "2026-06-21T09:00:00.000Z",
  "slaStatus":           "green"
}
```

Each task row also carries per-task fields:

```json
{
  "id": 42,
  "role": "caseworker",
  "status": "pending",
  "assigneeName": "Jane Smith",
  "completedAt": null,
  "dueDate": "2026-06-21T09:00:00.000Z",
  "waitingSince": "2026-06-14T09:00:00.000Z",
  "slaStatus": "green"
}
```

For completed or locked tasks, `waitingSince` and `slaStatus` are `null`.

---

## Frontend Component: `LicenceStages.jsx`

### Stage Header

Each stage row in the collapsible list shows an `SlaChip` (green/amber/red pill with dot indicator) inline with the stage title — visible to all roles, only when the stage is not yet complete.

### Ownership Panel (`OwnershipPanel`)

Rendered when a stage is expanded and has an active owner.

**Sponsor view (read-only, compact):**
```
[User icon] Jane Smith  [Clock icon] Waiting 3 days ago  [Amber chip] Due soon
```

**Caseworker / Admin view (full 6-field grid):**

| Field | Value |
|---|---|
| Current Stage | Stage 5 |
| Current Owner | Caseworker |
| Assigned To | Jane Smith |
| Waiting Since | 3 days ago |
| Due Date | 21 Jun 2026 |
| Current Status | `SlaChip` (green/amber/red) |

### Per-Task SLA Chip

For caseworker/admin, each task card within the expanded stage also shows its own `SlaChip` next to the action buttons. Sponsors do not see per-task chips (they see the compact stage-level summary only).

---

## Role Visibility Matrix

| Field | Sponsor | Caseworker | Admin |
|---|---|---|---|
| SLA chip in stage header | ✅ | ✅ | ✅ |
| Compact ownership row (name + waiting) | ✅ | — | — |
| Full 6-field ownership panel | — | ✅ | ✅ |
| Per-task SLA chip | — | ✅ | ✅ |
| Per-task waiting-since text | — | ✅ | ✅ |

---

## Data Model

No new DB columns were added. The `dueDate` column already existed on `licence_stage_tasks`. The `waitingSince` value is the task's `createdAt` (already present), surfaced via the API response — it is not stored as a separate field.

---

## Non-Destructive Guarantees

- Existing task rows without a `dueDate` (created before this change) surface as `slaStatus: null` — no chip shown.
- No existing task status or completion is altered.
- The ownership panel renders `null` for completed stages — no UI clutter on done stages.
- Sponsor's compact view is strictly additive (no fields removed, no buttons affected).

---

## Related Files

| File | Purpose |
|---|---|
| `src/services/licenceStageTask.service.js` | `STAGE_SLA_DAYS`, `computeSlaStatus`, `seedSingleTask` (seeds dueDate), `getStagesForApplication` (emits ownership fields) |
| `src/components/licence/LicenceStages.jsx` | `SlaChip`, `OwnershipPanel`, stage header chip, per-task chip |
