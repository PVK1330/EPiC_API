import crypto from "crypto";
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

/**
 * Authenticates requests using a Bearer API key.
 * Sets req.apiKey and req.apiOrganisation on success.
 */
export const authenticateApiKey = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ status: "error", message: "API key required. Use Authorization: Bearer <key>" });
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith("epic_")) {
    return res.status(401).json({ status: "error", message: "Invalid API key format" });
  }

  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  try {
    const apiKey = await platformDb.ApiKey.findOne({
      where: { key_hash: keyHash, is_active: true },
      include: [{ model: platformDb.Organisation, as: "organisation" }],
    });

    if (!apiKey) {
      return res.status(401).json({ status: "error", message: "Invalid or revoked API key" });
    }

    if (apiKey.expires_at && new Date() > new Date(apiKey.expires_at)) {
      return res.status(401).json({ status: "error", message: "API key has expired" });
    }

    // Fire-and-forget last_used_at update
    apiKey.update({ last_used_at: new Date() }).catch(() => {});

    req.apiKey = apiKey;
    req.apiOrganisation = apiKey.organisation;
    next();
  } catch (err) {
    logger.error({ err }, "API key authentication error");
    res.status(500).json({ status: "error", message: "Authentication error" });
  }
};

/**
 * Checks that the API key has a required scope.
 * Usage: requireScope("cases:read")
 */
export const requireScope = (scope) => (req, res, next) => {
  const scopes = req.apiKey?.scopes || [];
  if (!scopes.includes(scope) && !scopes.includes("*")) {
    return res.status(403).json({
      status: "error",
      message: `API key missing required scope: ${scope}`,
    });
  }
  next();
};
