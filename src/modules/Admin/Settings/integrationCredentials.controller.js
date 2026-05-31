// Integration Credentials Controller
// Per-tenant Google & Microsoft OAuth credentials, stored on
// organisations.smtp_settings.integrations.{google,microsoft}.
// Secrets are encrypted at rest and masked when read back.

import platformDb from "../../../models/index.js";
import logger from "../../../utils/logger.js";
import { encryptValue, decryptValue } from "../../../services/settings.service.js";

const MASK = "••••••••";

function getOrganisationId(req) {
  const id = req.user?.organisation_id;
  return id != null ? Number(id) : null;
}

function trimOrNull(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/** Pull the integrations block out of smtp_settings without disturbing SMTP. */
function readIntegrations(org) {
  const raw = org?.smtp_settings || {};
  return raw.integrations && typeof raw.integrations === "object"
    ? raw.integrations
    : {};
}

/** Shape a provider block for the client: real values for ids, masked secrets. */
function maskProvider(stored = {}) {
  return {
    client_id: stored.client_id || "",
    redirect_uri: stored.redirect_uri || "",
    // Microsoft only
    tenant_id: stored.tenant_id || "",
    authority: stored.authority || "",
    // Never return the secret; just signal whether one is saved.
    has_client_secret: Boolean(stored.client_secret),
    configured: Boolean(stored.client_id && stored.client_secret && stored.redirect_uri),
  };
}

export async function getIntegrationCredentials(req, res) {
  try {
    const orgId = getOrganisationId(req);
    if (!orgId) {
      return res.status(400).json({ status: "error", message: "Organisation context required" });
    }

    const org = await platformDb.Organisation.findByPk(orgId, {
      attributes: ["id", "smtp_settings"],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found" });
    }

    const integrations = readIntegrations(org);

    return res.json({
      status: "success",
      data: {
        google: maskProvider(integrations.google || {}),
        microsoft: maskProvider(integrations.microsoft || {}),
      },
    });
  } catch (err) {
    logger.error({ err }, "getIntegrationCredentials");
    return res.status(500).json({ status: "error", message: err.message });
  }
}

/**
 * Build the next stored provider block. Encrypts the secret when a new one is
 * supplied; preserves the existing secret when the field is left blank (so the
 * admin doesn't have to re-enter it on every edit).
 */
function buildStoredProvider(existing = {}, incoming = {}, { isMicrosoft = false } = {}) {
  const clientId = trimOrNull(incoming.client_id);
  const redirectUri = trimOrNull(incoming.redirect_uri);
  const next = {
    client_id: clientId,
    redirect_uri: redirectUri,
  };

  if (isMicrosoft) {
    next.tenant_id = trimOrNull(incoming.tenant_id) || "common";
    next.authority =
      trimOrNull(incoming.authority) ||
      `https://login.microsoftonline.com/${next.tenant_id}`;
  }

  const incomingSecret = trimOrNull(incoming.client_secret);
  if (incomingSecret && incomingSecret !== MASK) {
    next.client_secret = encryptValue(incomingSecret);
  } else if (existing.client_secret) {
    next.client_secret = existing.client_secret; // keep already-encrypted value
  }

  return next;
}

export async function updateIntegrationCredentials(req, res) {
  try {
    const orgId = getOrganisationId(req);
    if (!orgId) {
      return res.status(400).json({ status: "error", message: "Organisation context required" });
    }

    const org = await platformDb.Organisation.findByPk(orgId, {
      attributes: ["id", "smtp_settings"],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found" });
    }

    const raw = org.smtp_settings && typeof org.smtp_settings === "object"
      ? { ...org.smtp_settings }
      : {};
    const existing = readIntegrations(org);

    const nextIntegrations = { ...existing };

    if (req.body.google) {
      nextIntegrations.google = buildStoredProvider(existing.google, req.body.google);
    }
    if (req.body.microsoft) {
      nextIntegrations.microsoft = buildStoredProvider(existing.microsoft, req.body.microsoft, {
        isMicrosoft: true,
      });
    }

    // Persist without clobbering SMTP settings stored alongside.
    raw.integrations = nextIntegrations;
    await org.update({ smtp_settings: raw });
    await org.reload();

    const saved = readIntegrations(org);
    return res.json({
      status: "success",
      message: "Integration credentials saved",
      data: {
        google: maskProvider(saved.google || {}),
        microsoft: maskProvider(saved.microsoft || {}),
      },
    });
  } catch (err) {
    logger.error({ err }, "updateIntegrationCredentials");
    return res.status(500).json({ status: "error", message: err.message });
  }
}
