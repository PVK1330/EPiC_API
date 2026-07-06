import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ADMIN_ROLES } from '../../../middlewares/role.middleware.js';
import { createSignatureRequest, listAllSignatureRequests } from '../../Candidate/ESignature/esignature.controller.js';

const router = Router();

// SECURITY (BUG-004): this admin router was mounted with NO auth/role guard, so
// the org-wide e-signature queue and request-creation were reachable by any
// caller (they only 500'd because req.tenantDb was absent). Standard stack:
// authenticate + attach tenant DB, then restrict to admins.
router.use(verifyTokenAndTenant);
router.use(checkRole(ADMIN_ROLES));

router.get('/', listAllSignatureRequests);
router.post('/', createSignatureRequest);

export default router;
