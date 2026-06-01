// Google Routes
// Created at: 2026-05-29

import { Router } from "express";
import { verifyTokenAndTenant } from "../../../../middlewares/authStack.middleware.js";
import { oauthCallbackSession } from "../oauthCallback.middleware.js";
import * as googleController from "./google.controller.js";

const router = Router();

router.get("/auth-url", verifyTokenAndTenant, googleController.getGoogleAuthUrl);
router.get("/callback", oauthCallbackSession("google"), googleController.getGoogleCallback);
router.get("/status", verifyTokenAndTenant, googleController.getGoogleStatus);
router.post("/disconnect", verifyTokenAndTenant, googleController.disconnectGoogle);

export default router;
