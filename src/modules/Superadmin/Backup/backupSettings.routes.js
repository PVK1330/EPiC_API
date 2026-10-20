import { Router } from "express";
import { getBackupSettings, updateBackupSettings } from "./backupSettings.controller.js";

// Mounted (with auth + permission gating) by the backup routes under
// /api/superadmin/backups/settings.
const router = Router();

router.get("/", getBackupSettings);
router.put("/", updateBackupSettings);

export default router;
