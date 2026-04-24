import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import {
  createCaseNote,
  getCaseNotes,
  getCaseNoteByNoteId,
  updateCaseNote,
  deleteCaseNote
} from '../../controllers/AdminControllers/caseNote.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyToken);
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
