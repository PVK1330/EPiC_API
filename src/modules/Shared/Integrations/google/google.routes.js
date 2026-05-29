// Google Routes
// Created at: 2026-05-29

import { Router } from "express";
import { verifyTokenAndTenant } from "../../../../middlewares/authStack.middleware.js";
import * as googleController from "./google.controller.js";

const router = Router();

/**
 * Custom callback session restorer.
 * Since standard browser redirects for OAuth do not support injecting
 * custom Authorization headers, we can serialize the session token into
 * the state parameter during /auth-url creation, and reconstruct it here.
 */
const callbackAuthHook = (req, res, next) => {
  const { state } = req.query;
  
  if (state && !req.headers.authorization && !req.cookies?.token) {
    // If state contains a valid JWT token prefix, restore it
    if (state.startsWith("Bearer ")) {
      req.headers.authorization = state;
    } else if (state.length > 20) {
      req.headers.authorization = `Bearer ${state}`;
    }
  }
  
  verifyTokenAndTenant(req, res, next);
};

router.get("/auth-url", verifyTokenAndTenant, googleController.getGoogleAuthUrl);
router.get("/callback", callbackAuthHook, googleController.getGoogleCallback);
router.get("/status", verifyTokenAndTenant, googleController.getGoogleStatus);
router.post("/disconnect", verifyTokenAndTenant, googleController.disconnectGoogle);

export default router;
