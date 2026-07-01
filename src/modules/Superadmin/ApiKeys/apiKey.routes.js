import { Router } from "express";
import * as apiKeyController from "./apiKey.controller.js";

const router = Router();

router.get("/",     apiKeyController.listApiKeys);
router.post("/",    apiKeyController.createApiKey);
router.patch("/:id", apiKeyController.updateApiKey);
router.delete("/:id", apiKeyController.revokeApiKey);

export default router;
