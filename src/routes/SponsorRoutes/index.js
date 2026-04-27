import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import sponsorAccountRoutes from './sponsorAccount.routes.js';
import sponsorWorkerRoutes from './sponsorWorker.routes.js';

const router = Router();

// All sponsor routes require authentication and business role
router.use(verifyToken);
router.use(checkRole([ROLES.BUSINESS]));

router.use('/account', sponsorAccountRoutes);
router.use('/workers', sponsorWorkerRoutes);

export default router;
