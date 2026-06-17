# P2-WM-12 Race Condition Fix — Worker CoS Allocation

## Problem

Before this fix, `createSponsoredWorker` performed the over-allocation check as three separate, unlocked operations:

```
1. count(workers WHERE cosAllocationRecordId = X)   ← no lock
2. if count >= allocatedAmount → throw 409
3. SponsoredWorker.create(...)                       ← no lock
```

**Race window:** Between steps 1 and 3, any other concurrent request can read the same count and also pass the check. Both requests then reach step 3 and both create a worker row. Result: `N+1` workers for an `N`-slot allocation.

### Concrete example

```
allocatedAmount = 5, current workers = 4 (one slot left)

Request A:  count() → 4   ← passes check (4 < 5)
Request B:  count() → 4   ← passes check (4 < 5)  [before A commits]
Request A:  create() → worker #100  ✓
Request B:  create() → worker #101  ✗  (6th worker on 5-slot allocation)
```

---

## Fix

Wrap the **allocation ownership check**, **count**, **worker create**, and **audit write** in a single `sequelize.transaction()` with `SELECT FOR UPDATE` on `CosAllocationRecord`.

```js
return tenantDb.sequelize.transaction(async (t) => {
  // Exclusive row lock — serialises all concurrent creators for this allocation.
  const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
    attributes: ["id", "allocatedAmount", "sponsorId"],
    lock: t.LOCK.UPDATE,
    transaction: t,
  });

  // ... ownership check ...

  // Count inside the transaction — sees committed state from any prior request.
  const usedCount = await tenantDb.SponsoredWorker.count({
    where: { cosAllocationRecordId },
    transaction: t,
  });
  if (usedCount >= allocation.allocatedAmount) throw ALLOCATION_EXCEEDED;

  // Create and audit — both roll back if either fails.
  const worker = await tenantDb.SponsoredWorker.create({ ... }, { transaction: t });
  await tenantDb.SponsoredWorkerAudit.create({ ... }, { transaction: t });

  return worker;
});
```

### Why `FOR UPDATE` makes over-allocation impossible

The Postgres `SELECT ... FOR UPDATE` primitive places an **exclusive row lock** on `CosAllocationRecord`. Two callers competing for the same row are serialised:

```
Request A                          DB engine             Request B
─────────────────────────          ──────────────────    ─────────────────────────
findByPk(id, {lock:UPDATE})  →     grants lock to A
count() → 4  (passes)                                    findByPk(id, {lock:UPDATE})
create(worker #100)                                      ↑ BLOCKS here (waiting for A)
AuditLog.create(...)
COMMIT  ──────────────────── →     releases lock  →      gets lock
                                                         count() → 5  (fails: 5 >= 5)
                                                         throw ALLOCATION_EXCEEDED 409
```

After the fix, it is **mathematically impossible** for both requests to pass the count check simultaneously — one must block until the other commits, and will then re-read the count in the post-commit state.

---

## Files Changed

| File | Change |
|---|---|
| `src/services/sponsoredWorker.service.js` | `createSponsoredWorker` allocation path wrapped in `sequelize.transaction()` with `t.LOCK.UPDATE` |
| `tests/workerAllocationRace.test.js` | 10 new tests — lock acquisition, boundary conditions, concurrency simulation |

---

## Transaction Scope

| Operation | Before (unguarded) | After (guarded) |
|---|---|---|
| `CosAllocationRecord.findByPk` | Outside any transaction | Inside transaction, `lock: t.LOCK.UPDATE` |
| `SponsoredWorker.count` | Outside any transaction | Inside same transaction |
| `SponsoredWorker.create` | Outside any transaction | Inside same transaction |
| `SponsoredWorkerAudit.create` | Best-effort, outside tx | Inside same transaction — rolls back on failure |
| Notifications (future) | n/a | Must be added **after** the transaction resolves, never inside it |

---

## Non-Allocation Path

Workers created without a `cosAllocationRecordId` (free-form workers not tied to a CoS allocation) continue to use the simpler non-transactional path. There is no slot limit to enforce on this path.

---

## Test Coverage (`tests/workerAllocationRace.test.js`)

| # | Test | Assertion |
|---|---|---|
| 1 | FOR UPDATE lock acquired | `opts.lock === "UPDATE"` and `opts.transaction` truthy |
| 2 | count runs inside transaction | `opts.transaction` truthy on the count query |
| 3 | create runs inside transaction | `opts.transaction` truthy on SponsoredWorker.create |
| 4 | audit runs inside transaction | `opts.transaction` truthy on SponsoredWorkerAudit.create |
| 5 | Last slot succeeds | `usedCount=4, allocated=5` → worker created |
| 6 | Full allocation throws 409 | `usedCount=5, allocated=5` → ALLOCATION_EXCEEDED |
| 7 | Wrong owner throws 403 | `allocation.sponsorId ≠ sponsorId` → ALLOCATION_OWNERSHIP_VIOLATION |
| 8 | Missing allocation throws 404 | `findByPk → null` → 404 |
| 9 | **Concurrent simulation** | Two simultaneous requests, mutex-serialised: exactly 1 succeeds, 1 fails with ALLOCATION_EXCEEDED |
| 10 | No-allocation path unaffected | `cosAllocationRecordId = null` → created without transaction |

### How the concurrency test works

A true race cannot be reproduced in a single-threaded mock, but the test proves the logic is correct under the serial guarantee that `FOR UPDATE` provides. The mock implements a **promise-based mutex** (`lockChain`) that forces each transaction callback to await the previous one before executing — this is exactly the execution model that `SELECT FOR UPDATE` enforces at the DB layer.

```
Promise.all([reqA, reqB])
  reqA → enters transaction → grabs mutex → runs callback → count=4 → creates worker → releases mutex
  reqB → enters transaction → blocked on mutex → resumes → count=5 → throws ALLOCATION_EXCEEDED
```

Result: 1 worker created, 1 request rejected. ✓

---

## Deployment Notes

- No schema migration required — this is a pure service-layer change.
- Compatible with all existing workers and allocations.
- The `SELECT FOR UPDATE` lock is per-row (`cosAllocationRecordId`), so concurrent requests for **different** allocations are not serialised — no global throughput impact.
- MySQL / MariaDB: `t.LOCK.UPDATE` compiles to the same `SELECT ... FOR UPDATE` syntax — compatible.

---

*Fix for P2-WM-12 identified in `docs/final-go-live-report.md`*
