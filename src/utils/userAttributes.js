/**
 * Shared User attribute filtering for API responses.
 *
 * Every endpoint that returns a User row (list, detail, update-response,
 * dropdowns, self-profile) MUST strip these columns. Historically each
 * controller inlined its own `exclude` array and several of them omitted the
 * two 2FA columns, leaking the base32 TOTP seed + backup codes into responses
 * (a 2FA-bypass primitive). Centralising the list here removes that drift:
 * import `excludeSensitiveUserAttrs()` instead of hand-writing the array.
 *
 * NOTE: `two_factor_enabled` (a boolean flag) is intentionally NOT in this
 * list — login/profile responses legitimately expose whether 2FA is on. Only
 * the secret material (`two_factor_secret`, `two_factor_backup_codes`) is
 * stripped.
 */

/**
 * Columns that must never be serialised to any client, including the owner.
 * @type {string[]}
 */
export const SENSITIVE_USER_FIELDS = Object.freeze([
  'password',
  'otp_code',
  'otp_expiry',
  'password_reset_otp',
  'password_reset_otp_expiry',
  'temp_password',
  'two_factor_secret',
  'two_factor_backup_codes',
  // Lockout state — internal brute-force counters. No client/UI consumes these
  // (verified: no frontend reference), and returning them to admins/caseworkers
  // via GET /api/user/all leaked every account's lockout posture (data-leakage-2
  // / data-leakage-8). `two_factor_enabled` (a boolean) stays exposed — the UI
  // needs it — only the secret material and lockout counters are stripped.
  'failed_login_attempts',
  'locked_until',
]);

/**
 * Sequelize `attributes` option that excludes every sensitive User column.
 *
 * Returns a fresh object on each call so callers can safely spread/mutate it
 * (e.g. to merge with an `include`) without affecting other queries.
 *
 * @returns {{ exclude: string[] }}
 */
export function excludeSensitiveUserAttrs() {
  return { exclude: [...SENSITIVE_USER_FIELDS] };
}
