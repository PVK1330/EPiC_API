import crypto from "crypto";
import platformDb from "../../../models/index.js";
import logger from "../../../utils/logger.js";

function generateApiKey() {
  const env = process.env.NODE_ENV === "production" ? "live" : "test";
  const secret = crypto.randomBytes(32).toString("hex");
  const rawKey = `epic_${env}_${secret}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  return { rawKey, keyHash, keyPrefix };
}

/** POST /superadmin/api-keys — Admin creates a key for an organisation */
export const createApiKey = async (req, res) => {
  try {
    const { organisation_id, name, scopes = ["*"], expires_at } = req.body;
    if (!organisation_id || !name) {
      return res.status(400).json({ status: "error", message: "organisation_id and name are required" });
    }

    const org = await platformDb.Organisation.findByPk(organisation_id);
    if (!org) return res.status(404).json({ status: "error", message: "Organisation not found" });

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const apiKey = await platformDb.ApiKey.create({
      organisation_id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes,
      expires_at: expires_at || null,
      created_by: req.user?.userId || null,
    });

    // Return raw key only once
    res.status(201).json({
      status: "success",
      message: "API key created. Store it securely — it will not be shown again.",
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        key_prefix: keyPrefix,
        scopes,
        expires_at: apiKey.expires_at,
        created_at: apiKey.createdAt,
      },
    });
  } catch (err) {
    logger.error({ err }, "createApiKey error");
    res.status(500).json({ status: "error", message: "Failed to create API key" });
  }
};

/** GET /superadmin/api-keys?organisation_id=X */
export const listApiKeys = async (req, res) => {
  try {
    const { organisation_id } = req.query;
    const where = organisation_id ? { organisation_id } : {};
    const keys = await platformDb.ApiKey.findAll({
      where,
      include: [{ model: platformDb.Organisation, as: "organisation", attributes: ["id", "name", "slug"] }],
      order: [["created_at", "DESC"]],
      attributes: { exclude: ["key_hash"] },
    });
    res.json({ status: "success", data: keys });
  } catch (err) {
    logger.error({ err }, "listApiKeys error");
    res.status(500).json({ status: "error", message: "Failed to list API keys" });
  }
};

/** DELETE /superadmin/api-keys/:id — revoke */
export const revokeApiKey = async (req, res) => {
  try {
    const key = await platformDb.ApiKey.findByPk(req.params.id);
    if (!key) return res.status(404).json({ status: "error", message: "API key not found" });
    await key.update({ is_active: false });
    res.json({ status: "success", message: "API key revoked" });
  } catch (err) {
    logger.error({ err }, "revokeApiKey error");
    res.status(500).json({ status: "error", message: "Failed to revoke API key" });
  }
};

/** PATCH /superadmin/api-keys/:id — update name/scopes/expiry */
export const updateApiKey = async (req, res) => {
  try {
    const key = await platformDb.ApiKey.findByPk(req.params.id);
    if (!key) return res.status(404).json({ status: "error", message: "API key not found" });
    const { name, scopes, expires_at, is_active } = req.body;
    await key.update({ name, scopes, expires_at, is_active });
    res.json({ status: "success", data: key });
  } catch (err) {
    logger.error({ err }, "updateApiKey error");
    res.status(500).json({ status: "error", message: "Failed to update API key" });
  }
};
