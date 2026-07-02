import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ADMIN_ROLES } from '../../../middlewares/role.middleware.js';
import { createSignatureRequest, listAllSignatureRequests } from '../../Candidate/ESignature/esignature.controller.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole(ADMIN_ROLES));

router.get('/', listAllSignatureRequests);
router.post('/', createSignatureRequest);

export default router;
