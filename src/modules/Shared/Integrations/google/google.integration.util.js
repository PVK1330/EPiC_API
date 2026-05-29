import logger from "../../../../utils/logger.js";

export function getRequestUserId(req) {
  return req.user?.userId ?? req.user?.id ?? null;
}

/**
 * Resolve the tenant-scoped user id (platform and tenant ids are usually aligned).
 */
export async function resolveTenantUserId(req) {
  const userId = getRequestUserId(req);
  if (!userId || !req.tenantDb?.User) {
    return null;
  }

  const byId = await req.tenantDb.User.findByPk(userId, { attributes: ["id"] });
  if (byId) return byId.id;

  const email = req.user?.email;
  if (email) {
    const byEmail = await req.tenantDb.User.findOne({
      where: { email: String(email).trim().toLowerCase() },
      attributes: ["id"],
    });
    if (byEmail) {
      logger.warn(
        { platformUserId: userId, tenantUserId: byEmail.id, email },
        "Resolved tenant user by email for Google integration",
      );
      return byEmail.id;
    }
  }

  return null;
}

export function buildFrontendOAuthRedirect(req, sync) {
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  const role = String(req.user?.role_name || "caseworker").toLowerCase();

  if (role === "admin") {
    return `${frontendUrl}/admin/settings?tab=integrations&sync=${encodeURIComponent(sync)}`;
  }

  return `${frontendUrl}/${role}/calendar?sync=${encodeURIComponent(sync)}`;
}
