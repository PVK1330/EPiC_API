# P2-WM-13 Soft Delete Compliance — Sponsored Worker Records

## Problem

`SponsoredWorker` records were being hard-deleted (physically removed from the database). Under UK immigration law and Home Office sponsor guidance, all sponsored worker records must be retained for the duration of the sponsorship and for a defined period after its end. Hard deletion violates this requirement and makes immigration history unrecoverable.

---

## Fix Summary

Sequelize `paranoid` mode has been enabled on the `SponsoredWorker` model. All `destroy()` calls now set `deleted_at` instead of issuing a `DELETE` statement. No row is ever physically removed. Deleted records are invisible to all standard queries and can be reinstated by an admin at any time.

---

## Schema Migration

**File:** `src/migrations/tenants/20260617000000-add-deleted-at-to-sponsored-workers.sql`

```sql
ALTER TABLE sponsored_workers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sponsored_workers_deleted_at
  ON sponsored_workers (deleted_at)
  WHERE deleted_at IS NULL;
```

The partial index (`WHERE deleted_at IS NULL`) keeps the common query path fast — only live rows are indexed.

**Rollback:** `src/migrations/tenants/rollback/20260617000000-add-deleted-at-to-sponsored-workers.rollback.sql`

---

## Model Changes

**File:** `src/models/tenant/sponsoredWorker.model.js`

Added to the model options:

```js
paranoid: true,
deletedAt: "deleted_at",
```

Sequelize now:
- Automatically appends `WHERE deleted_at IS NULL` to every `findAll`, `findOne`, `findByPk`, and `count` query.
- Translates `instance.destroy()` to `UPDATE ... SET deleted_at = NOW()` instead of `DELETE`.
- Exposes `instance.restore()` to clear `deleted_at`.

---

## Service Changes

**File:** `src/services/sponsoredWorker.service.js`

### New audit action constants

```js
DELETED:  "worker_deleted",
RESTORED: "worker_restored",
```

### `softDeleteWorker(tenantDb, workerId, actorId)`

- Locks the row (`SELECT FOR UPDATE`) to prevent concurrent delete + state-change races.
- Calls `worker.destroy({ transaction })` — paranoid soft delete.
- Writes a `worker_deleted` audit row in the same transaction.
- Throws HTTP 404 if the worker does not exist.

### `restoreWorker(tenantDb, workerId, actorId)`

- Fetches the row with `paranoid: false` (deleted rows visible) and locks it.
- Calls `worker.restore({ transaction })` to clear `deleted_at`.
- Writes a `worker_restored` audit row in the same transaction.
- Throws HTTP 404 if the record doesn't exist, HTTP 409 if it was never deleted.

### `listAllWorkers` — `includeDeleted` flag

```js
listAllWorkers(tenantDb, { status, sponsorId, includeDeleted: false })
```

When `includeDeleted: true`, the query passes `paranoid: false` to Sequelize, returning both live and soft-deleted records. Default behaviour (all existing callers) is unchanged.

---

## API Endpoints

### Sponsor — Soft Delete

| Method | Path | Auth | Description |
|---|---|---|---|
| `DELETE` | `/api/licence/workers/:id` | Sponsor | Soft-delete own worker (sets `deleted_at`) |

**Controller:** `src/modules/Sponsor/Licence/sponsorWorker.controller.js` — `deleteMyWorker`  
**Route file:** `src/modules/Sponsor/Licence/sponsorWorker.routes.js`

The handler verifies `worker.sponsorId === req.user.userId` before deleting, preventing cross-sponsor deletion.

### Admin — Soft Delete + Restore + View Deleted

| Method | Path | Auth | Description |
|---|---|---|---|
| `DELETE` | `/api/admin/workers/:id` | Admin | Soft-delete any worker |
| `POST` | `/api/admin/workers/:id/restore` | Admin | Restore a soft-deleted worker |
| `GET` | `/api/admin/workers?includeDeleted=true` | Admin | List all workers including deleted |

**Controller:** `src/modules/Admin/Settings/adminWorker.controller.js`  
**Route file:** `src/modules/Admin/Settings/admin.worker.routes.js`

---

## Audit Trail

Every delete and restore is recorded in `SponsoredWorkerAudit` within the same database transaction, so the audit is atomic with the operation.

| Event | `action` column | `fromStatus` | `toStatus` |
|---|---|---|---|
| Soft delete | `worker_deleted` | Last live status | `null` |
| Restore | `worker_restored` | `null` | Current status |

---

## How Paranoid Mode Works

```
Standard query (all existing callers):
  SELECT * FROM sponsored_workers WHERE deleted_at IS NULL AND ...

includeDeleted=true (admin only):
  SELECT * FROM sponsored_workers WHERE ...    ← no deleted_at filter

Soft delete:
  UPDATE sponsored_workers SET deleted_at = NOW() WHERE id = ?

Restore:
  UPDATE sponsored_workers SET deleted_at = NULL WHERE id = ?
```

No existing query needed to be updated — Sequelize adds the `WHERE deleted_at IS NULL` clause automatically once `paranoid: true` is set on the model.

---

## Files Changed

| File | Change |
|---|---|
| `src/models/tenant/sponsoredWorker.model.js` | Added `paranoid: true`, `deletedAt: "deleted_at"` |
| `src/migrations/tenants/20260617000000-add-deleted-at-to-sponsored-workers.sql` | New — adds `deleted_at` column + partial index |
| `src/migrations/tenants/rollback/20260617000000-add-deleted-at-to-sponsored-workers.rollback.sql` | New — drops column + index |
| `src/services/sponsoredWorker.service.js` | Added `DELETED`/`RESTORED` constants; `softDeleteWorker()`; `restoreWorker()`; `includeDeleted` flag on `listAllWorkers` |
| `src/modules/Sponsor/Licence/sponsorWorker.controller.js` | Added `deleteMyWorker` handler |
| `src/modules/Sponsor/Licence/sponsorWorker.routes.js` | Added `DELETE /:id` route |
| `src/modules/Admin/Settings/adminWorker.controller.js` | Added `deleteWorkerAdmin`, `restoreWorkerAdmin`; `includeDeleted` wired to `getAllWorkers` |
| `src/modules/Admin/Settings/admin.worker.routes.js` | Added `DELETE /:id` and `POST /:id/restore` routes |
| `tests/workerSoftDelete.test.js` | New — 4 tests covering all compliance scenarios |

---

## Test Coverage (`tests/workerSoftDelete.test.js`)

| # | Test | Assertion |
|---|---|---|
| 1 | Delete hides worker | `deletedAt` set; `findAll` returns 0 rows after delete |
| 2 | Restore brings worker back | `deletedAt` cleared; `findAll` returns 1 row after restore |
| 3 | Audit rows created | `worker_deleted` + `worker_restored` events written with correct fields |
| 4 | `includeDeleted` flag | Default → 0 rows; `includeDeleted=true` → 1 row |

---

## Deployment Notes

1. Run `20260617000000-add-deleted-at-to-sponsored-workers.sql` against each tenant database before deploying the new code.
2. Existing `sponsored_workers` rows will have `deleted_at = NULL` after migration — they are treated as live records. No data change is needed.
3. Any `SponsoredWorker.destroy()` call (current or future) will produce a soft delete automatically — no code change needed at call sites.
4. The `SELECT FOR UPDATE` lock in `softDeleteWorker` serialises concurrent delete + state-change on the same worker row, preventing a torn state where a worker is simultaneously being advanced and deleted.

---

*Fix for P2-WM-13 identified in `docs/final-go-live-report.md`*
