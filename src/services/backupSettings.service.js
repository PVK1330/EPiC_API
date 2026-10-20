/**
 * backupSettings.service.js
 *
 * Effective backup/restore settings, resolved in priority order:
 *   1. per-organisation override  (platform_settings `backup.org.<id>.<field>`)
 *   2. global DB value            (platform_settings `backup.<field>`)
 *   3. environment default        (BACKUP_* env vars, see .env.example)
 *
 * Pure helpers are exported for unit testing. Heavy dependencies (models,
 * settings service) are imported lazily so importing this file is side-effect
 * free.
 */

// ─── Limits ──────────────────────────────────────────────────────────────────
export const LIMITS = Object.freeze({
  reminderDays: { min: 1, max: 90 },
  retentionHours: { min: 1, max: 720 },
  maxUploadMb: { min: 1, max: 102400 },
});

export const GLOBAL_KEYS = Object.freeze([
  "reminder_enabled",
  "reminder_days",
  "org_download_enabled",
  "org_restore_enabled",
  "retention_hours",
]);
export const ORG_FIELDS = Object.freeze(["reminder_days", "download_enabled", "restore_enabled"]);

const CAMEL = {
  reminder_enabled: "reminderEnabled",
  reminder_days: "reminderDays",
  org_download_enabled: "orgDownloadEnabled",
  org_restore_enabled: "orgRestoreEnabled",
  retention_hours: "retentionHours",
};

const CACHE_TTL_MS = 30_000;
let _cache = null; // { at, map }

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Robust boolean parse. Returns `fallback` when the value is not recognisable. */
export function parseBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on", "enabled"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", "disabled"].includes(s)) return false;
  return fallback;
}

/** Parse to an integer clamped to [min,max]; returns `fallback` if not numeric. */
export function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** True when a stored/raw value is "present" (not null/undefined/empty string). */
function has(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Env defaults, already parsed + clamped. */
export function getEnvDefaults(env = process.env) {
  return {
    reminder_enabled: parseBool(env.BACKUP_REMINDER_ENABLED, true),
    reminder_days: clampInt(env.BACKUP_REMINDER_DAYS, LIMITS.reminderDays.min, LIMITS.reminderDays.max, 7),
    org_download_enabled: parseBool(env.BACKUP_ORG_DOWNLOAD_ENABLED, true),
    org_restore_enabled: parseBool(env.BACKUP_ORG_RESTORE_ENABLED, false),
    retention_hours: clampInt(env.BACKUP_RETENTION_HOURS, LIMITS.retentionHours.min, LIMITS.retentionHours.max, 48),
  };
}

export function getMaxUploadMb(env = process.env) {
  return clampInt(env.BACKUP_MAX_UPLOAD_MB, LIMITS.maxUploadMb.min, LIMITS.maxUploadMb.max, 2048);
}

/**
 * Pure resolver: override -> global -> env. Invalid stored values fall through
 * to the next level rather than throwing.
 * @param {object} p
 * @param {object} p.env      parsed env defaults (getEnvDefaults())
 * @param {object} p.global   raw global values keyed by short key (reminder_days, ...)
 * @param {object} p.override raw per-org values (reminder_days, download_enabled, restore_enabled)
 */
export function resolveSettings({ env, global = {}, override = {}, maxUploadMb = 2048 }) {
  const pickInt = (ov, gl, envVal, lim) => {
    const fromGlobal = has(gl) ? clampInt(gl, lim.min, lim.max, envVal) : envVal;
    return has(ov) ? clampInt(ov, lim.min, lim.max, fromGlobal) : fromGlobal;
  };
  const pickBool = (ov, gl, envVal) => {
    const fromGlobal = has(gl) ? parseBool(gl, envVal) : envVal;
    return has(ov) ? parseBool(ov, fromGlobal) : fromGlobal;
  };

  return {
    reminderEnabled: pickBool(undefined, global.reminder_enabled, env.reminder_enabled),
    reminderDays: pickInt(override.reminder_days, global.reminder_days, env.reminder_days, LIMITS.reminderDays),
    orgDownloadEnabled: pickBool(override.download_enabled, global.org_download_enabled, env.org_download_enabled),
    orgRestoreEnabled: pickBool(override.restore_enabled, global.org_restore_enabled, env.org_restore_enabled),
    retentionHours: pickInt(undefined, global.retention_hours, env.retention_hours, LIMITS.retentionHours),
    maxUploadMb,
  };
}

/**
 * Validate a partial global settings object. Returns { value, errors }.
 * `null` means "clear the DB value (fall back to env)".
 */
export function validateGlobalPatch(input) {
  const errors = [];
  const value = {};
  if (input === undefined) return { value, errors };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value, errors: ["global must be an object"] };
  }
  for (const [k, v] of Object.entries(input)) {
    if (!GLOBAL_KEYS.includes(k)) { errors.push(`Unknown global setting: ${k}`); continue; }
    if (v === null) { value[k] = null; continue; }
    if (k === "reminder_days" || k === "retention_hours") {
      const lim = k === "reminder_days" ? LIMITS.reminderDays : LIMITS.retentionHours;
      if (typeof v !== "number" || !Number.isInteger(v) || v < lim.min || v > lim.max) {
        errors.push(`${k} must be an integer between ${lim.min} and ${lim.max}`);
      } else value[k] = v;
    } else if (typeof v !== "boolean") {
      errors.push(`${k} must be a boolean`);
    } else value[k] = v;
  }
  return { value, errors };
}

/** Validate organisation_overrides shape/types (existence of ids is checked by the caller). */
export function validateOrgOverrides(input) {
  const errors = [];
  const value = [];
  if (input === undefined) return { value, errors };
  if (!Array.isArray(input)) return { value, errors: ["organisation_overrides must be an array"] };
  input.forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`organisation_overrides[${i}] must be an object`);
      return;
    }
    const { organisation_id, ...rest } = item;
    const id = Number(organisation_id);
    if (!Number.isInteger(id) || id <= 0) {
      errors.push(`organisation_overrides[${i}].organisation_id must be a positive integer`);
      return;
    }
    const out = { organisation_id: id };
    for (const [k, v] of Object.entries(rest)) {
      if (!ORG_FIELDS.includes(k)) { errors.push(`organisation_overrides[${i}]: unknown key ${k}`); continue; }
      if (v === null) { out[k] = null; continue; }
      if (k === "reminder_days") {
        if (!Number.isInteger(v) || v < LIMITS.reminderDays.min || v > LIMITS.reminderDays.max) {
          errors.push(
            `organisation_overrides[${i}].reminder_days must be an integer between ${LIMITS.reminderDays.min} and ${LIMITS.reminderDays.max}`,
          );
        } else out[k] = v;
      } else if (typeof v !== "boolean") {
        errors.push(`organisation_overrides[${i}].${k} must be a boolean`);
      } else out[k] = v;
    }
    value.push(out);
  });
  return { value, errors };
}

// ─── DB access (lazy) ────────────────────────────────────────────────────────

async function loadMap({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.map;
  const { getSettingsByNamespace } = await import("./settings.service.js");
  let map = {};
  try {
    map = await getSettingsByNamespace("backup");
  } catch {
    map = {}; // DB unavailable -> fall back to env defaults
  }
  _cache = { at: Date.now(), map };
  return map;
}

export function invalidateBackupSettingsCache() {
  _cache = null;
}

function orgOverrideFromMap(map, organisationId) {
  const out = {};
  for (const f of ORG_FIELDS) out[f] = map[`org.${organisationId}.${f}`];
  return out;
}

/** Effective settings for an org (or platform-wide when organisationId is null). */
export async function getEffectiveBackupSettings(organisationId = null) {
  const map = await loadMap();
  const global = {};
  for (const k of GLOBAL_KEYS) global[k] = map[k];
  const override = organisationId != null ? orgOverrideFromMap(map, organisationId) : {};
  return resolveSettings({ env: getEnvDefaults(), global, override, maxUploadMb: getMaxUploadMb() });
}

/** Dedupe timestamp used by the reminder job. scopeKey: `org.<id>` or `platform`. */
export async function getLastRemindedAt(scopeKey) {
  const map = await loadMap({ fresh: true });
  const raw = map[`${scopeKey}.last_reminded_at`];
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export async function setLastRemindedAt(scopeKey, date = new Date()) {
  const { upsertSetting } = await import("./settings.service.js");
  await upsertSetting(`backup.${scopeKey}.last_reminded_at`, date.toISOString());
  invalidateBackupSettingsCache();
}

// ─── Admin UI ────────────────────────────────────────────────────────────────

export async function getBackupSettingsForAdminUI() {
  const map = await loadMap({ fresh: true });
  const env = getEnvDefaults();
  const global = {};
  for (const k of GLOBAL_KEYS) {
    const raw = map[k];
    global[k] = has(raw) ? resolveSettings({ env, global: { [k]: raw } })[CAMEL[k]] : env[k];
  }
  const platformDb = (await import("../models/index.js")).default;
  const orgs = await platformDb.Organisation.findAll({
    attributes: ["id", "name"],
    order: [["name", "ASC"]],
    raw: true,
  });
  const organisations = orgs.map((o) => {
    const ov = orgOverrideFromMap(map, o.id);
    return {
      id: o.id,
      name: o.name,
      reminder_days: has(ov.reminder_days)
        ? clampInt(ov.reminder_days, LIMITS.reminderDays.min, LIMITS.reminderDays.max, null)
        : null,
      download_enabled: has(ov.download_enabled) ? parseBool(ov.download_enabled, null) : null,
      restore_enabled: has(ov.restore_enabled) ? parseBool(ov.restore_enabled, null) : null,
    };
  });
  return { global, env_defaults: env, organisations };
}

/**
 * Validate + persist. Throws an Error with `.status = 400` and `.details` on
 * validation failure. Returns { changed: [descriptions] } for audit logging.
 */
export async function saveBackupSettings(body = {}) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    errors.push("Body must be an object");
  } else {
    for (const k of Object.keys(body)) {
      if (k !== "global" && k !== "organisation_overrides") errors.push(`Unknown key: ${k}`);
    }
  }

  const g = validateGlobalPatch(body?.global);
  const o = validateOrgOverrides(body?.organisation_overrides);
  errors.push(...g.errors, ...o.errors);

  const platformDb = (await import("../models/index.js")).default;
  if (!errors.length && o.value.length) {
    const ids = [...new Set(o.value.map((x) => x.organisation_id))];
    const found = await platformDb.Organisation.findAll({ where: { id: ids }, attributes: ["id"], raw: true });
    const foundIds = new Set(found.map((r) => Number(r.id)));
    for (const id of ids) if (!foundIds.has(id)) errors.push(`Organisation ${id} not found`);
  }
  if (errors.length) {
    const err = new Error(errors[0]);
    err.status = 400;
    err.details = errors;
    throw err;
  }

  const { upsertSetting } = await import("./settings.service.js");
  const changed = [];
  const clear = (key) => platformDb.PlatformSetting.destroy({ where: { key } });

  for (const [k, v] of Object.entries(g.value)) {
    if (v === null) await clear(`backup.${k}`);
    else await upsertSetting(`backup.${k}`, v);
    changed.push(`backup.${k}=${v === null ? "(cleared)" : v}`);
  }
  for (const item of o.value) {
    for (const f of ORG_FIELDS) {
      if (!(f in item)) continue;
      const key = `backup.org.${item.organisation_id}.${f}`;
      if (item[f] === null) await clear(key);
      else await upsertSetting(key, item[f]);
      changed.push(`${key}=${item[f] === null ? "(cleared)" : item[f]}`);
    }
  }
  invalidateBackupSettingsCache();
  return { changed };
}

export default {
  getEffectiveBackupSettings,
  getBackupSettingsForAdminUI,
  saveBackupSettings,
  getEnvDefaults,
  invalidateBackupSettingsCache,
};
