import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

const PREFS_KEY = "notification_preferences";

const DEFAULT_PREFS = {
  subscription_events: true,
  organisation_events: true,
  team_events: true,
  security_alerts: true,
  billing_alerts: true,
  system_updates: false,
};

export const getNotificationPreferences = catchAsync(async (req, res) => {
  const setting = await platformDb.PlatformSetting.findOne({
    where: { key: PREFS_KEY },
  });

  const preferences = setting ? JSON.parse(setting.value) : DEFAULT_PREFS;

  return ApiResponse.success(res, "Notification preferences retrieved", {
    preferences,
  });
});

export const updateNotificationPreferences = catchAsync(async (req, res) => {
  const incoming = req.body || {};

  const allowed = Object.keys(DEFAULT_PREFS);
  const preferences = {};
  for (const k of allowed) {
    preferences[k] = k in incoming ? Boolean(incoming[k]) : DEFAULT_PREFS[k];
  }

  await platformDb.PlatformSetting.upsert({
    key: PREFS_KEY,
    value: JSON.stringify(preferences),
  });

  return ApiResponse.success(res, "Notification preferences saved", {
    preferences,
  });
});
