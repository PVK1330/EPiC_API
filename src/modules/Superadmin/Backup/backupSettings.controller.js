/**
 * backupSettings.controller.js
 * GET/PUT handlers for backup/restore settings (router mounted by the backup routes).
 */
import catchAsync from "../../../utils/catchAsync.js";
import ApiResponse from "../../../utils/apiResponse.js";
import {
  getBackupSettingsForAdminUI,
  saveBackupSettings,
} from "../../../services/backupSettings.service.js";
import { recordPlatformAuditLog } from "../../../services/platformActivity.service.js";

export const getBackupSettings = catchAsync(async (req, res) => {
  const data = await getBackupSettingsForAdminUI();
  return ApiResponse.success(res, "Backup settings retrieved", data);
});

export const updateBackupSettings = catchAsync(async (req, res) => {
  let result;
  try {
    result = await saveBackupSettings(req.body);
  } catch (err) {
    if (err?.status === 400) return ApiResponse.badRequest(res, err.details?.join("; ") || err.message);
    throw err;
  }

  if (result.changed.length) {
    await recordPlatformAuditLog({
      category: "System",
      action: "Backup Settings Updated",
      user: req.user?.email || "superadmin",
      user_id: req.user?.id ?? null,
      org: "Global System",
      description: `Updated backup settings: ${result.changed.join(", ")}`.slice(0, 2000),
      ip_address: req.ip,
      status: "Success",
    });
  }

  const data = await getBackupSettingsForAdminUI();
  return ApiResponse.success(res, "Backup settings updated", data);
});
