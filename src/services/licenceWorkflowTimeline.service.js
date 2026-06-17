/**
 * Licence Workflow Timeline
 *
 * Aggregates the full cross-entity history of a sponsor licence journey into a
 * single chronological timeline. The events live in three separate places:
 *   - Licence application audit  (licence_application_audits)  → submission,
 *     information request/response, under review, licence granted.
 *   - CoS requests / allocations (cos_requests, cos_allocation_records).
 *   - Sponsored worker audit     (sponsored_worker_audits)     → worker created,
 *     visa granted.
 *
 * CoS and worker records are keyed by the sponsor user (sponsorId), not by the
 * licence application, so they are linked via the application owner's userId.
 *
 * Every emitted event is normalised to:
 *   { id, eventKey, event, actorRole, actorName, timestamp, status, comment }
 * where actorRole is the responsible swim-lane (Sponsor | Caseworker | Admin |
 * Compliance) used by the UI to group the timeline.
 */

export const ACTOR_ROLES = Object.freeze(["Sponsor", "Caseworker", "Admin", "Compliance"]);

const fullName = (u) =>
  u ? [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || null : null;

const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);

/** Title-cases a snake_case action as a human label fallback. */
function humanize(action) {
  return String(action || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Event";
}

/**
 * Map a licence audit row to one of the recognised licence workflow events.
 * Returns { eventKey, event, actorRole } or null to fall back to a generic entry.
 */
function mapLicenceAudit(action, newStatus) {
  const a = String(action || "").toLowerCase();
  const s = String(newStatus || "");

  if (a === "request_info" || s === "Information Requested")
    return { eventKey: "information_requested", event: "Information Requested", actorRole: "Caseworker" };
  if (a === "info_responded")
    return { eventKey: "information_received", event: "Information Received", actorRole: "Sponsor" };
  if (a === "under_review" || a === "review_started" || s === "Under Review")
    return { eventKey: "under_review", event: "Under Review", actorRole: "Caseworker" };
  if (a === "licence_granted" || a === "approve" || s === "Licence Granted" || s === "Approved")
    return { eventKey: "licence_granted", event: "Licence Granted", actorRole: "Admin" };
  if (a === "submit" || a === "review" || s === "Submitted" || s === "Pending")
    return { eventKey: "application_submitted", event: "Application Submitted", actorRole: "Sponsor" };
  return null;
}

/** Worker audit action → recognised event. Worker lifecycle is Compliance-owned. */
function mapWorkerAudit(action) {
  const a = String(action || "").toLowerCase();
  if (a === "created")      return { eventKey: "worker_created", event: "Worker Created", actorRole: "Admin" };
  if (a === "visa_granted") return { eventKey: "visa_granted", event: "Visa Granted", actorRole: "Compliance" };
  return null;
}

/**
 * Pure, DB-free builder. Accepts already-flattened plain rows from each source
 * and returns the merged, chronologically-sorted timeline. Unit-testable.
 *
 * @param {object} sources
 * @param {Array}  sources.licenceAudits  [{ id, action, previousStatus, newStatus, notes, createdAt, actorName }]
 * @param {Array}  sources.cosRequests    [{ id, status, reason, visaType, requestedAmount, createdAt, actorName }]
 * @param {Array}  sources.cosAllocations [{ id, notes, visaType, allocatedAmount, allocatedAt, actorName }]
 * @param {Array}  sources.workerAudits   [{ id, action, toStatus, notes, createdAt, actorName, workerName }]
 */
export function buildWorkflowEvents({
  licenceAudits = [],
  cosRequests = [],
  cosAllocations = [],
  workerAudits = [],
} = {}) {
  const events = [];

  for (const r of licenceAudits) {
    const mapped = mapLicenceAudit(r.action, r.newStatus) || {
      eventKey: String(r.action || "event").toLowerCase(),
      event: humanize(r.action),
      actorRole: "Caseworker",
    };
    events.push({
      id: `licence-${r.id}`,
      eventKey: mapped.eventKey,
      event: mapped.event,
      actorRole: mapped.actorRole,
      actorName: r.actorName || "System",
      timestamp: iso(r.createdAt),
      status: r.newStatus || mapped.event,
      comment: r.notes || null,
    });
  }

  for (const r of cosRequests) {
    events.push({
      id: `cos-req-${r.id}`,
      eventKey: "cos_requested",
      event: "CoS Requested",
      actorRole: "Sponsor",
      actorName: r.actorName || "Sponsor",
      timestamp: iso(r.createdAt),
      status: r.status || "Pending",
      comment: r.reason || (r.visaType ? `${r.visaType}${r.requestedAmount ? ` × ${r.requestedAmount}` : ""}` : null),
    });
  }

  for (const r of cosAllocations) {
    events.push({
      id: `cos-alloc-${r.id}`,
      eventKey: "cos_allocated",
      event: "CoS Allocated",
      actorRole: "Admin",
      actorName: r.actorName || "Admin",
      timestamp: iso(r.allocatedAt),
      status: "Allocated",
      comment: r.notes || (r.visaType ? `${r.visaType}${r.allocatedAmount ? ` × ${r.allocatedAmount}` : ""}` : null),
    });
  }

  for (const r of workerAudits) {
    const mapped = mapWorkerAudit(r.action);
    if (!mapped) continue; // only surface the recognised worker milestones
    events.push({
      id: `worker-${r.id}`,
      eventKey: mapped.eventKey,
      event: mapped.event,
      actorRole: mapped.actorRole,
      actorName: r.actorName || "System",
      timestamp: iso(r.createdAt),
      status: r.toStatus || mapped.event,
      comment: r.workerName ? `${r.workerName}${r.notes ? ` — ${r.notes}` : ""}` : (r.notes || null),
    });
  }

  // Chronological (oldest first). Null timestamps sink to the end deterministically.
  return events.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

/**
 * Read the four sources for an application and return the merged timeline.
 * Resilient: a failure in any one source is logged-by-omission (empty array)
 * rather than failing the whole timeline.
 */
export async function getWorkflowTimeline(tenantDb, application) {
  if (!tenantDb || !application) return [];
  const applicationId = application.id;
  const sponsorUserId = application.userId;

  const safe = (p) => p.then((r) => r).catch(() => []);

  const [auditRows, cosReqRows, cosAllocRows, workerRows] = await Promise.all([
    safe(tenantDb.LicenceApplicationAudit.findAll({
      where: { licenceApplicationId: applicationId },
      include: [{ model: tenantDb.User, as: "actor", attributes: ["id", "first_name", "last_name", "email"] }],
    })),
    sponsorUserId ? safe(tenantDb.CosRequest.findAll({
      where: { sponsorId: sponsorUserId },
      include: [{ model: tenantDb.User, as: "sponsor", attributes: ["id", "first_name", "last_name", "email"] }],
    })) : Promise.resolve([]),
    sponsorUserId ? safe(tenantDb.CosAllocationRecord.findAll({
      where: { sponsorId: sponsorUserId },
      include: [{ model: tenantDb.User, as: "allocatedBy", attributes: ["id", "first_name", "last_name", "email"] }],
    })) : Promise.resolve([]),
    sponsorUserId ? safe(tenantDb.SponsoredWorker.findAll({
      where: { sponsorId: sponsorUserId },
      attributes: ["id", "workerFirstName", "workerLastName"],
      include: [{
        model: tenantDb.SponsoredWorkerAudit, as: "auditTrail",
        include: [{ model: tenantDb.User, as: "actor", attributes: ["id", "first_name", "last_name", "email"] }],
      }],
    })) : Promise.resolve([]),
  ]);

  const licenceAudits = auditRows.map((r) => ({
    id: r.id, action: r.action, previousStatus: r.previousStatus, newStatus: r.newStatus,
    notes: r.notes, createdAt: r.created_at || r.createdAt, actorName: fullName(r.actor),
  }));

  const cosRequests = cosReqRows.map((r) => ({
    id: r.id, status: r.status, reason: r.reason, visaType: r.visaType,
    requestedAmount: r.requestedAmount, createdAt: r.created_at || r.createdAt, actorName: fullName(r.sponsor),
  }));

  const cosAllocations = cosAllocRows.map((r) => ({
    id: r.id, notes: r.notes, visaType: r.visaType, allocatedAmount: r.allocatedAmount,
    allocatedAt: r.allocatedAt || r.created_at || r.createdAt, actorName: fullName(r.allocatedBy),
  }));

  const workerAudits = [];
  for (const w of workerRows) {
    const workerName = [w.workerFirstName, w.workerLastName].filter(Boolean).join(" ").trim() || null;
    for (const a of w.auditTrail || []) {
      workerAudits.push({
        id: a.id, action: a.action, toStatus: a.toStatus, notes: a.notes,
        createdAt: a.created_at || a.createdAt, actorName: fullName(a.actor), workerName,
      });
    }
  }

  return buildWorkflowEvents({ licenceAudits, cosRequests, cosAllocations, workerAudits });
}

export default { ACTOR_ROLES, buildWorkflowEvents, getWorkflowTimeline };
