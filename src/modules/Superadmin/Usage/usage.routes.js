import { Router } from "express";
import * as usageController from "./usage.controller.js";

const router = Router();

router.get("/alerts",    usageController.getUsageAlerts);
router.get("/:orgId",    usageController.getOrganisationUsage);
router.get("/",          usageController.getPlatformUsageOverview);

export default router;
