import { verifyToken } from "./auth.middleware.js";
import { attachTenantDb } from "./tenantDb.middleware.js";

/** Use on all tenant-scoped protected routes (after public auth routes). */
export const verifyTokenAndTenant = [verifyToken, attachTenantDb];
