import { Router } from "express";
import * as billing from "./orgBilling.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../../middlewares/role.middleware.js";

const router = Router();

// Org-admin self-service subscription billing.
// verifyToken only (no attachTenantDb) so it stays reachable while the org is
// suspended — verifyToken exempts /api/billing for expired org admins.
router.use(verifyToken, checkRole([ROLES.ADMIN]));

router.get("/subscription", billing.getMySubscription);
router.post("/checkout", billing.createCheckoutSession);
router.post("/verify-session/:sessionId", billing.verifySession);

export default router;
