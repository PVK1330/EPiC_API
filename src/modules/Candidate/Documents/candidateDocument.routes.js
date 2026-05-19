import { Router } from "express";
import { getCandidateDocumentChecklist } from "../../Admin/Settings/documentChecklist.controller.js";

const router = Router();

router.get("/checklist", getCandidateDocumentChecklist);

export default router;
