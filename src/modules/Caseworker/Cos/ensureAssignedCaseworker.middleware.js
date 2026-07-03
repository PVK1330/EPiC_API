/**
 * Route-level ownership guard for CoS mutation routes (ISSUE-014).
 *
 * Admins (role 3) and superadmins (role 5) pass unconditionally — they have
 * platform-wide access and do not need to be listed on the request.
 *
 * Caseworkers (role 2) are allowed only when their userId appears in
 * CosRequest.assignedCaseworkerIds (a JSONB array that may hold numeric ids,
 * numeric strings, or {id} objects — normalised by isCaseworkerAssignedToCos).
 *
 * On success the loaded CosRequest row is attached as req.cosRequest so the
 * downstream controller can skip a redundant DB round-trip.
 */

import { hasFullAccessRole } from "../../../middlewares/role.middleware.js";
import { isCaseworkerAssignedToCos } from "../../../services/cosRequest.service.js";

export async function ensureAssignedCaseworker(req, res, next) {
  const { user, tenantDb, params } = req;

  if (!user) {
    return res.status(401).json({ status: "error", message: "Authentication required" });
  }

  // Validate the id param is a positive integer BEFORE any DB query, so a
  // non-numeric id returns a clean 400 instead of a 500 that leaks the raw
  // Postgres type-cast error (parity with the shared ensureAssignedCaseworker).
  const cosId = Number(params.id);
  if (!Number.isInteger(cosId) || cosId <= 0) {
    return res.status(400).json({ status: "error", message: "A valid CoS request id is required" });
  }

  // Admins and superadmins bypass the assignment check — no DB load needed.
  if (hasFullAccessRole(user.role_id)) return next();

  try {
    const request = await tenantDb.CosRequest.findByPk(params.id, {
      attributes: ["id", "assignedCaseworkerIds"],
    });

    if (!request) {
      return res.status(404).json({ status: "error", message: "CoS request not found" });
    }

    if (!isCaseworkerAssignedToCos(request, user.userId)) {
      return res.status(403).json({
        status: "error",
        message: "You are not assigned to this CoS request.",
      });
    }

    req.cosRequest = request;
    return next();
  } catch (err) {
    return next(err);
  }
}
