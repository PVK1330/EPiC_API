import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import { memoryUpload } from "../../../middlewares/upload.middleware.js";
import * as ccl from "./ccl.controller.js";

const router = Router();

// CCL templates and per-case drafts are managed by admins and caseworkers.
router.use(verifyTokenAndTenant, checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// ── Org-level templates ───────────────────────────────────────────────────────
router.get("/templates/tags", ccl.getTags);
router.post("/templates/preview", ccl.previewTemplate);
router.get("/templates", ccl.listTemplates);
router.post("/templates", ccl.createTemplate);
router.get("/templates/:id", ccl.getTemplate);
router.put("/templates/:id", ccl.updateTemplate);
router.delete("/templates/:id", ccl.deleteTemplate);

// ── Per-case CCL (draft → issue) ───────────────────────────────────────────────
router.get("/cases/:caseId", ccl.getCaseCcl);
router.put("/cases/:caseId/draft", ccl.saveCaseDraft);
router.post("/cases/:caseId/draft/import", memoryUpload.single("file"), ccl.importCaseDraft);
router.post("/cases/:caseId/preview", ccl.previewCaseCcl);
router.post("/cases/:caseId/issue", ccl.issueCaseCcl);

export default router;
