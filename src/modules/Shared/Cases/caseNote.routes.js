import { Router } from 'express';
import * as caseNoteController from '../../Admin/Dashboard/caseNote.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication and role-based access
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Case note routes
router.post("/", caseNoteController.createCaseNote);
router.get("/", caseNoteController.getCaseNotes);
router.get("/note/:id", caseNoteController.getCaseNoteByNoteId);
router.put("/:id", caseNoteController.updateCaseNote);
router.delete("/:id", caseNoteController.deleteCaseNote);

export default router;
