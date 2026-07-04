import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import * as announcementController from './adminAnnouncement.controller.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

// /export before /:id so the literal path can never be captured as an id.
router.get('/export', announcementController.exportTenantAnnouncements);
router.get('/', announcementController.listTenantAnnouncements);
router.post('/', announcementController.createTenantAnnouncement);
router.put('/:id', announcementController.updateTenantAnnouncement);
router.delete('/:id', announcementController.deleteTenantAnnouncement);

export default router;
