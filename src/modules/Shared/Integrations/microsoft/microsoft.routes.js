// Microsoft Routes
// Created at: 2026-05-29

import { Router } from "express";
import { verifyTokenAndTenant } from "../../../../middlewares/authStack.middleware.js";
import { oauthCallbackSession } from "../oauthCallback.middleware.js";
import * as microsoftController from "./microsoft.controller.js";

const router = Router();

router.get("/auth-url", verifyTokenAndTenant, microsoftController.getMicrosoftAuthUrl);
router.get("/callback", oauthCallbackSession("microsoft"), microsoftController.getMicrosoftCallback);
router.get("/status", verifyTokenAndTenant, microsoftController.getMicrosoftStatus);
router.post("/disconnect", verifyTokenAndTenant, microsoftController.disconnectMicrosoft);

export default router;
