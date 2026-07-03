import { Router } from 'express';
import { createSignatureRequest, listAllSignatureRequests } from '../../Candidate/ESignature/esignature.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, STAFF_ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// SECURITY (BUG-004): this admin router was mounted with NO auth/role guard, so
// the org-wide e-signature queue and request-creation were reachable by any
// caller (they only 500'd because req.tenantDb was absent). Restore the standard
// stack: authenticate + attach tenant DB, then restrict to staff.
router.use(verifyTokenAndTenant);
router.use(checkRole(STAFF_ROLES));

router.get('/', listAllSignatureRequests);
router.post('/', createSignatureRequest);

export default router;
