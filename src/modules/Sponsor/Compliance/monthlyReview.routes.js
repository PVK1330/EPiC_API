/**
 * Monthly Compliance Review Routes — Section N
 *
 * Mounted at /api/business/compliance/monthly-reviews via the Sponsor panel
 * index router. Authentication and BUSINESS-role enforcement are applied by
 * the parent Sponsor router before these routes are reached.
 */

import { Router } from "express";
import {
  listMonthlyReviews,
  getMonthlyReview,
  generateMonthlyReview,
} from "./monthlyReview.controller.js";

const router = Router();

// List all past monthly reviews (paginated, no payload column).
router.get("/", listMonthlyReviews);

// Manual trigger: generate a monthly review on-demand.
// Mounted BEFORE /:id so the literal "generate" path is not swallowed by the
// dynamic :id segment.
router.post("/generate", generateMonthlyReview);

// Single review with full five-section payload.
router.get("/:id", getMonthlyReview);

export default router;
