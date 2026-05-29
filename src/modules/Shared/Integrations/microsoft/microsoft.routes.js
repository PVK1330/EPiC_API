// Microsoft Routes
// Created at: 2026-05-29

import { Router } from "express";
import { verifyTokenAndTenant } from "../../../../middlewares/authStack.middleware.js";
import * as microsoftController from "./microsoft.controller.js";

const router = Router();

/**
 * Custom callback session restorer for Microsoft redirects.
 */
const callbackAuthHook = (req, res, next) => {
  const { state } = req.query;
  
  if (state && !req.headers.authorization && !req.cookies?.token) {
    if (state.startsWith("Bearer ")) {
      req.headers.authorization = state;
    } else if (state.length > 20) {
      req.headers.authorization = `Bearer ${state}`;
    }
  }
  
  verifyTokenAndTenant(req, res, next);
};

router.get("/auth-url", verifyTokenAndTenant, microsoftController.getMicrosoftAuthUrl);
router.get("/callback", callbackAuthHook, microsoftController.getMicrosoftCallback);
router.get("/status", verifyTokenAndTenant, microsoftController.getMicrosoftStatus);
router.post("/disconnect", verifyTokenAndTenant, microsoftController.disconnectMicrosoft);

export default router;
