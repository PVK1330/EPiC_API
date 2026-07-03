import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import * as announcementController from './adminAnnouncement.controller.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

router.post('/', announcementController.createTenantAnnouncement);
router.get('/', announcementController.listTenantAnnouncements);
router.get('/export', announcementController.exportTenantAnnouncements);
router.put('/:id', announcementController.updateTenantAnnouncement);
router.delete('/:id', announcementController.deleteTenantAnnouncement);

export default router;
