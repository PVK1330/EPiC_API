import { Router } from "express";
import * as adminSettingsController from "../controllers/AdminControllers/admin.settings.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN]));

router.get("/me", adminSettingsController.getMe);
router.patch("/me", adminSettingsController.patchMe);
router.post("/change-password", adminSettingsController.changePassword);

router.get("/visa-types", adminSettingsController.listVisaTypes);
router.post("/visa-types", adminSettingsController.createVisaType);
router.patch("/visa-types/:id", adminSettingsController.updateVisaType);
router.delete("/visa-types/:id", adminSettingsController.deleteVisaType);

router.get("/case-categories", adminSettingsController.listCaseCategories);
router.post("/case-categories", adminSettingsController.createCaseCategory);
router.delete("/case-categories/:id", adminSettingsController.deleteCaseCategory);

router.get("/email-templates", adminSettingsController.listEmailTemplates);
router.get("/email-templates/:key", adminSettingsController.getEmailTemplateByKey);
router.put("/email-templates/:key", adminSettingsController.updateEmailTemplate);

router.get("/sla", adminSettingsController.getSla);
router.put("/sla", adminSettingsController.updateSla);

export default router;
