import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Mock settings.service.js so no DB is touched; the settings service imports it lazily.
const store = {};
mock.module("../src/services/settings.service.js", {
  namedExports: {
    getSettingsByNamespace: async () => ({ ...store }),
    upsertSetting: async (key, value) => {
      store[key.replace(/^backup\./, "")] = String(value);
    },
  },
});

const svc = await import("../src/services/backupSettings.service.js");
const job = await import("../src/jobs/backupReminder.job.js");

const env = svc.getEnvDefaults({});

describe("parseBool / clampInt", () => {
  it("parses booleans robustly", () => {
    for (const v of [true, "true", "TRUE", " 1 ", "yes", "on", 1]) assert.equal(svc.parseBool(v, false), true);
    for (const v of [false, "false", "0", "no", "OFF", 0]) assert.equal(svc.parseBool(v, true), false);
    assert.equal(svc.parseBool("garbage", true), true);
    assert.equal(svc.parseBool(undefined, false), false);
  });
  it("clamps and falls back", () => {
    assert.equal(svc.clampInt("500", 1, 90, 7), 90);
    assert.equal(svc.clampInt(0, 1, 90, 7), 1);
    assert.equal(svc.clampInt("abc", 1, 90, 7), 7);
    assert.equal(svc.clampInt("", 1, 90, 7), 7);
    assert.equal(svc.clampInt(12.9, 1, 90, 7), 12);
  });
});

describe("env defaults", () => {
  it("uses documented defaults", () => {
    assert.deepEqual(env, {
      reminder_enabled: true, reminder_days: 7, org_download_enabled: true,
      org_restore_enabled: false, retention_hours: 48,
    });
    assert.equal(svc.getMaxUploadMb({}), 2048);
  });
  it("reads and clamps env values", () => {
    const e = svc.getEnvDefaults({ BACKUP_REMINDER_DAYS: "999", BACKUP_RETENTION_HOURS: "0", BACKUP_ORG_RESTORE_ENABLED: "yes", BACKUP_REMINDER_ENABLED: "off" });
    assert.equal(e.reminder_days, 90);
    assert.equal(e.retention_hours, 1);
    assert.equal(e.org_restore_enabled, true);
    assert.equal(e.reminder_enabled, false);
  });
});

describe("resolveSettings priority", () => {
  it("env only", () => {
    const r = svc.resolveSettings({ env });
    assert.equal(r.reminderDays, 7);
    assert.equal(r.orgRestoreEnabled, false);
  });
  it("global beats env", () => {
    const r = svc.resolveSettings({ env, global: { reminder_days: "14", org_restore_enabled: "true" } });
    assert.equal(r.reminderDays, 14);
    assert.equal(r.orgRestoreEnabled, true);
  });
  it("org override beats global; invalid override falls through", () => {
    const g = { reminder_days: "14", org_download_enabled: "true" };
    assert.equal(svc.resolveSettings({ env, global: g, override: { reminder_days: "3" } }).reminderDays, 3);
    assert.equal(svc.resolveSettings({ env, global: g, override: { reminder_days: "zzz" } }).reminderDays, 14);
    assert.equal(svc.resolveSettings({ env, global: g, override: { download_enabled: "false" } }).orgDownloadEnabled, false);
  });
  it("clamps stored values", () => {
    const r = svc.resolveSettings({ env, global: { reminder_days: "1000", retention_hours: "99999" } });
    assert.equal(r.reminderDays, 90);
    assert.equal(r.retentionHours, 720);
  });
});

describe("getEffectiveBackupSettings (mocked store)", () => {
  it("resolves per-org override over global", async () => {
    svc.invalidateBackupSettingsCache();
    store.reminder_days = "10";
    store["org.5.reminder_days"] = "2";
    assert.equal((await svc.getEffectiveBackupSettings(5)).reminderDays, 2);
    assert.equal((await svc.getEffectiveBackupSettings(6)).reminderDays, 10);
    assert.equal((await svc.getEffectiveBackupSettings()).reminderDays, 10);
  });
  it("last_reminded_at round-trips", async () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    await svc.setLastRemindedAt("org.5", d);
    assert.equal((await svc.getLastRemindedAt("org.5")).toISOString(), d.toISOString());
    assert.equal(await svc.getLastRemindedAt("org.99"), null);
  });
});

describe("validation", () => {
  it("global patch", () => {
    assert.deepEqual(svc.validateGlobalPatch({ reminder_days: 5, org_restore_enabled: true, retention_hours: null }).errors, []);
    assert.ok(svc.validateGlobalPatch({ reminder_days: 0 }).errors.length);
    assert.ok(svc.validateGlobalPatch({ reminder_days: "5" }).errors.length);
    assert.ok(svc.validateGlobalPatch({ org_restore_enabled: "true" }).errors.length);
    assert.ok(svc.validateGlobalPatch({ bogus: 1 }).errors.length);
    assert.ok(svc.validateGlobalPatch([]).errors.length);
  });
  it("org overrides", () => {
    const ok = svc.validateOrgOverrides([{ organisation_id: 3, reminder_days: null, download_enabled: false }]);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.value[0].reminder_days, null);
    assert.ok(svc.validateOrgOverrides([{ reminder_days: 3 }]).errors.length);
    assert.ok(svc.validateOrgOverrides([{ organisation_id: 1, nope: true }]).errors.length);
    assert.ok(svc.validateOrgOverrides([{ organisation_id: 1, reminder_days: 91 }]).errors.length);
    assert.ok(svc.validateOrgOverrides("x").errors.length);
  });
});

describe("reminder dedupe logic", () => {
  const now = new Date("2026-06-30T09:00:00Z");
  const ago = (d) => new Date(now.getTime() - d * 86400000);
  it("no backup -> remind", () => {
    const v = job.evaluateReminder({ lastBackupAt: null, lastRemindedAt: null, reminderDays: 7, now });
    assert.equal(v.remind, true);
    assert.equal(v.reason, "no_backup");
  });
  it("recent backup -> no reminder", () => {
    assert.equal(job.evaluateReminder({ lastBackupAt: ago(3), lastRemindedAt: null, reminderDays: 7, now }).remind, false);
  });
  it("stale backup -> remind; boundary at exactly reminderDays", () => {
    assert.equal(job.evaluateReminder({ lastBackupAt: ago(7), lastRemindedAt: null, reminderDays: 7, now }).remind, true);
    assert.equal(job.evaluateReminder({ lastBackupAt: ago(6), lastRemindedAt: null, reminderDays: 7, now }).remind, false);
  });
  it("deduped within window, allowed after", () => {
    const base = { lastBackupAt: ago(30), reminderDays: 7, now };
    assert.equal(job.evaluateReminder({ ...base, lastRemindedAt: ago(1) }).remind, false);
    assert.equal(job.evaluateReminder({ ...base, lastRemindedAt: ago(1) }).reason, "already_reminded");
    assert.equal(job.evaluateReminder({ ...base, lastRemindedAt: ago(7) }).remind, true);
  });
  it("messages are friendly", () => {
    assert.match(job.buildOrgReminderMessage(null).message, /No backup has been taken yet/);
    assert.match(job.buildOrgReminderMessage(9).message, /9 days since your last backup.*Settings → Backup/);
    assert.match(job.buildPlatformReminderMessage(1).message, /1 day since.*Superadmin → Backups/);
  });
});
