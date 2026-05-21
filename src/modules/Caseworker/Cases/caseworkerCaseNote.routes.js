import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import {
  createCaseNote,
  getCaseNotes,
  getCaseNoteByNoteId,
  updateCaseNote,
  deleteCaseNote
} from '../../Admin/Dashboard/caseNote.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Routes
router.post('/', 
  createCaseNote
);

router.get('/', 
  getCaseNotes
);

router.get('/:noteId', 
  getCaseNoteByNoteId
);

router.put('/:noteId', 
  updateCaseNote
);

router.delete('/:noteId', 
  deleteCaseNote
);

export default router;
