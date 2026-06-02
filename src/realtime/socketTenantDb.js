import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";

/**
 * Resolve (and memoize on the socket) the tenant DB for a connected socket,
 * based on the authenticated user's organisation. Returns null when the socket
 * has no organisation context or the tenant DB is not provisioned.
 *
 * @param {import('socket.io').Socket} socket
 * @returns {Promise<object|null>}
 */
export async function getSocketTenantDb(socket) {
  if (socket.tenantDb) return socket.tenantDb;

  const orgId =
    socket.user?.organisation_id != null ? Number(socket.user.organisation_id) : null;
  if (!orgId || Number.isNaN(orgId)) return null;

  const org = await platformDb.Organisation.findByPk(orgId, {
    attributes: ["database_name"],
  });
  if (!org?.database_name) return null;

  socket.tenantDb = getTenantDb(org.database_name);
  return socket.tenantDb;
}
