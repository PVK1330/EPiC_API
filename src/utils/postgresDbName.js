/**
 * PostgreSQL identifiers: lowercase letters, digits, underscore; must start with a letter.
 */
export function normalizePostgresDatabaseName(name, fallback = "epic_api") {
  let n = String(name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!n) n = fallback;
  if (!/^[a-z]/.test(n)) n = `epic_${n}`;

  return n.slice(0, 63);
}

export function isValidPostgresDatabaseName(name) {
  return /^[a-z][a-z0-9_]{0,62}$/.test(String(name || ""));
}
