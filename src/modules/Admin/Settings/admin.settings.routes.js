import { Router } from 'express';
import * as adminSettingsController from './admin.settings.controller.js';
import * as smtpSettingsController from './smtp.settings.controller.js';
import * as visaController from './visa.controller.js';
import * as petitionTypeController from './petitionType.controller.js';
import * as integrationsDashboardController from './integrationsDashboard.controller.js';
import * as integrationCredentialsController from './integrationCredentials.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import { handleProfilePicUpload, handleCclTemplateUpload, handleOrganisationLogoUpload } from '../../../middlewares/upload.middleware.js';

const router = Router();

// Public routes accessible by authenticated users (admin, caseworker, candidate, business)
router.use(verifyTokenAndTenant);
router.get("/visa-types/dropdown", checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.BUSINESS, ROLES.CANDIDATE]), visaController.dropdownVisaType);
router.get("/petition-types/dropdown", checkRole([ROLES.ADMIN, ROLES.CASEWORKER]), petitionTypeController.dropdownPetitionType);
router.get(
  "/organisation/branding",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.BUSINESS, ROLES.CANDIDATE]),
  adminSettingsController.getOrganisationBranding,
);

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
router.post("/visa-types/:id/ccl-template", handleCclTemplateUpload, visaController.uploadCclTemplate);
router.delete("/visa-types/:id/ccl-template", visaController.deleteCclTemplate);

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

router.get("/organisation", adminSettingsController.getOrganisation);
router.post("/organisation/logo", handleOrganisationLogoUpload, adminSettingsController.uploadOrganisationLogo);

router.get("/smtp-settings", smtpSettingsController.getSmtpSettings);
router.put("/smtp-settings", smtpSettingsController.updateSmtpSettings);
router.post("/smtp-settings/test", smtpSettingsController.testSmtpSettings);

router.get("/integrations/credentials", integrationCredentialsController.getIntegrationCredentials);
router.put("/integrations/credentials", integrationCredentialsController.updateIntegrationCredentials);

router.get("/integrations/microsoft/dashboard", integrationsDashboardController.getMicrosoftDashboardStats);
router.get("/integrations/google/dashboard", integrationsDashboardController.getGoogleDashboardStats);
router.get("/integrations/retry-queue", integrationsDashboardController.getIntegrationRetryQueue);
router.get("/integrations/sync-logs", integrationsDashboardController.getIntegrationSyncLogs);

export default router;
