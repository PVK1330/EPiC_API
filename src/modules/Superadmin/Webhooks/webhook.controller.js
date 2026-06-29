import crypto from "crypto";
import platformDb from "../../../models/index.js";
import logger from "../../../utils/logger.js";
import { WEBHOOK_EVENTS } from "../../../services/webhook.service.js";

/** GET /superadmin/webhooks — list all endpoints */
export const listWebhookEndpoints = async (req, res) => {
  try {
    const { organisation_id } = req.query;
    const where = organisation_id ? { organisation_id } : {};
    const endpoints = await platformDb.WebhookEndpoint.findAll({
      where,
      include: [{ model: platformDb.Organisation, as: "organisation", attributes: ["id", "name"] }],
      attributes: { exclude: ["secret"] },
      order: [["created_at", "DESC"]],
    });
    res.json({ status: "success", data: endpoints });
  } catch (err) {
    logger.error({ err }, "listWebhookEndpoints error");
    res.status(500).json({ status: "error", message: "Failed to list webhook endpoints" });
  }
};

/** POST /superadmin/webhooks */
export const createWebhookEndpoint = async (req, res) => {
  try {
    const { organisation_id, url, events = [], description } = req.body;
    if (!organisation_id || !url) {
      return res.status(400).json({ status: "error", message: "organisation_id and url are required" });
    }
    const invalidEvents = events.filter((e) => e !== "*" && !Object.values(WEBHOOK_EVENTS).includes(e));
    if (invalidEvents.length) {
      return res.status(400).json({ status: "error", message: `Invalid events: ${invalidEvents.join(", ")}` });
    }
    const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
    const endpoint = await platformDb.WebhookEndpoint.create({
      organisation_id,
      url,
      secret,
      events,
      description,
      created_by: req.user?.userId,
    });
    res.status(201).json({
      status: "success",
      data: { ...endpoint.toJSON(), secret },
      message: "Webhook endpoint created. Store the secret securely — it will not be shown again.",
    });
  } catch (err) {
    logger.error({ err }, "createWebhookEndpoint error");
    res.status(500).json({ status: "error", message: "Failed to create webhook endpoint" });
  }
};

/** DELETE /superadmin/webhooks/:id */
export const deleteWebhookEndpoint = async (req, res) => {
  try {
    const ep = await platformDb.WebhookEndpoint.findByPk(req.params.id);
    if (!ep) return res.status(404).json({ status: "error", message: "Endpoint not found" });
    await ep.update({ is_active: false });
    res.json({ status: "success", message: "Webhook endpoint disabled" });
  } catch (err) {
    logger.error({ err }, "deleteWebhookEndpoint error");
    res.status(500).json({ status: "error", message: "Failed to disable endpoint" });
  }
};

/** GET /superadmin/webhooks/:id/logs — delivery history */
export const getDeliveryLogs = async (req, res) => {
  try {
    const logs = await platformDb.WebhookDeliveryLog.findAll({
      where: { webhook_endpoint_id: req.params.id },
      order: [["created_at", "DESC"]],
      limit: 100,
    });
    res.json({ status: "success", data: logs });
  } catch (err) {
    logger.error({ err }, "getDeliveryLogs error");
    res.status(500).json({ status: "error", message: "Failed to fetch delivery logs" });
  }
};

/** GET /superadmin/webhooks/events — list all available event types */
export const listEventTypes = async (_req, res) => {
  res.json({ status: "success", data: Object.values(WEBHOOK_EVENTS) });
};
