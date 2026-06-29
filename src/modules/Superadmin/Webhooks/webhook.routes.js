import { Router } from "express";
import * as webhookController from "./webhook.controller.js";

const router = Router();

router.get("/events",       webhookController.listEventTypes);
router.get("/",             webhookController.listWebhookEndpoints);
router.post("/",            webhookController.createWebhookEndpoint);
router.delete("/:id",       webhookController.deleteWebhookEndpoint);
router.get("/:id/logs",     webhookController.getDeliveryLogs);

export default router;
