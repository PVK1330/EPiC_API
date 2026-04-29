import { Router } from "express";
import * as adminSettingsController from "../controllers/AdminControllers/admin.settings.controller.js";
import * as visaController from "../controllers/AdminControllers/Settings/visa.controller.js";
import * as petitionTypeController from "../controllers/AdminControllers/Settings/petitionType.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";
import { handleProfilePicUpload } from "../middlewares/upload.middleware.js";

const router = Router();

// Public routes accessible by authenticated users (admin or caseworker)
router.use(verifyToken);
router.get("/visa-types/dropdown", checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.BUSINESS]), visaController.dropdownVisaType);
router.get("/petition-types/dropdown", checkRole([ROLES.ADMIN, ROLES.CASEWORKER]), petitionTypeController.dropdownPetitionType);

// Admin-only routes
router.use(checkRole([ROLES.ADMIN]));

router.get("/me", adminSettingsController.getMe);
router.patch("/me", handleProfilePicUpload, adminSettingsController.patchMe);
router.patch("/me/preferences", adminSettingsController.patchMePreferences);
router.post("/change-password", adminSettingsController.changePassword);

router.get("/visa-types", visaController.listVisaTypes);
router.post("/visa-types", visaController.createVisaType);
router.patch("/visa-types/:id", visaController.updateVisaType);
router.delete("/visa-types/:id", visaController.deleteVisaType);

router.get("/petition-types", petitionTypeController.listPetitionTypes);
router.post("/petition-types", petitionTypeController.createPetitionType);
router.patch("/petition-types/:id", petitionTypeController.updatePetitionType);
router.delete("/petition-types/:id", petitionTypeController.deletePetitionType);

router.get("/case-categories", adminSettingsController.listCaseCategories);
router.post("/case-categories", adminSettingsController.createCaseCategory);
router.delete("/case-categories/:id", adminSettingsController.deleteCaseCategory);

router.get("/email-templates", adminSettingsController.listEmailTemplates);
router.post("/email-templates", adminSettingsController.createEmailTemplate);
router.get("/email-templates/:key", adminSettingsController.getEmailTemplateByKey);
router.put("/email-templates/:key", adminSettingsController.updateEmailTemplate);
router.delete("/email-templates/:key", adminSettingsController.deleteEmailTemplate);

router.get("/sla-rules", adminSettingsController.listSlaRules);
router.post("/sla-rules", adminSettingsController.createSlaRule);
router.patch("/sla-rules/:id", adminSettingsController.updateSlaRule);
router.delete("/sla-rules/:id", adminSettingsController.deleteSlaRule);

router.get("/payment-settings", adminSettingsController.getPaymentSetting);
router.put("/payment-settings", adminSettingsController.updatePaymentSetting);

export default router;
