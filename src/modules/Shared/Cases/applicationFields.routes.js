import { Router } from 'express';
import * as applicationFieldsController from '../../Admin/applicationFields.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyTokenAndTenant);

// Apply role-based access control - Only Admin can manage application fields
router.use(checkRole([ROLES.ADMIN]));

// Field Settings Routes
router.get("/settings", applicationFieldsController.getFieldSettings);
router.patch("/settings/visibility", applicationFieldsController.batchUpdateFieldVisibility);
router.patch("/settings/by-id/:id/visibility", applicationFieldsController.updateFieldVisibilityById);
router.patch("/settings/:field_key/visibility", applicationFieldsController.updateSingleFieldVisibility);
router.put("/settings/:field_key", applicationFieldsController.updateFieldSetting);

// Custom Fields Routes
router.get("/custom-fields", applicationFieldsController.getCustomFields);
router.post("/custom-fields", applicationFieldsController.createCustomField);
router.put("/custom-fields/:id", applicationFieldsController.updateCustomField);
router.delete("/custom-fields/:id", applicationFieldsController.deleteCustomField);

export default router;
