/**
 * Public REST API v1 — authenticated via Bearer API key.
 * Week 9 Task 1: OpenAPI-documented, rate-limited public API for tenant integrations.
 *
 * Base path: /api/v1
 */
import { Router } from "express";
import { authenticateApiKey, requireScope } from "../../../middlewares/apiKeyAuth.middleware.js";
import { publicApiLimiter, publicApiWriteLimiter } from "../../../middlewares/apiRateLimiter.middleware.js";
import { getTenantDb } from "../../../services/tenantDb.service.js";
import { withCache } from "../../../services/cache.service.js";
import logger from "../../../utils/logger.js";

const router = Router();

// All v1 routes require a valid API key + rate limiting
router.use(publicApiLimiter, authenticateApiKey);

// ── Helpers ──────────────────────────────────────────────────────────────────
const safe = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    logger.error({ err }, "Public API error");
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

async function orgTenantDb(req) {
  const org = req.apiOrganisation;
  return getTenantDb(org.slug || String(org.id));
}

// ── GET /api/v1/info ─────────────────────────────────────────────────────────
router.get("/info", safe(async (req, res) => {
  res.json({
    status: "success",
    data: {
      api_version: "1.0",
      organisation: {
        id: req.apiOrganisation.id,
        name: req.apiOrganisation.name,
        slug: req.apiOrganisation.slug,
      },
      scopes: req.apiKey.scopes,
    },
  });
}));

// ── GET /api/v1/cases ────────────────────────────────────────────────────────
router.get("/cases", requireScope("cases:read"), safe(async (req, res) => {
  const tenantDb = await orgTenantDb(req);
  const cacheKey = `v1:cases:${req.apiOrganisation.id}`;
  const data = await withCache(cacheKey, 60, () =>
    tenantDb.Case.findAll({
      where: { deleted_at: null },
      attributes: ["id", "status", "visa_type", "created_at", "updated_at"],
      limit: 200,
      order: [["created_at", "DESC"]],
    })
  );
  res.json({ status: "success", count: data.length, data });
}));

// ── GET /api/v1/cases/:id ────────────────────────────────────────────────────
router.get("/cases/:id", requireScope("cases:read"), safe(async (req, res) => {
  const tenantDb = await orgTenantDb(req);
  const c = await tenantDb.Case.findOne({ where: { id: req.params.id, deleted_at: null } });
  if (!c) return res.status(404).json({ status: "error", message: "Case not found" });
  res.json({ status: "success", data: c });
}));

// ── GET /api/v1/workers ──────────────────────────────────────────────────────
router.get("/workers", requireScope("workers:read"), safe(async (req, res) => {
  const tenantDb = await orgTenantDb(req);
  const cacheKey = `v1:workers:${req.apiOrganisation.id}`;
  const data = await withCache(cacheKey, 60, () =>
    tenantDb.SponsoredWorker.findAll({
      where: { deleted_at: null },
      attributes: ["id", "worker_first_name", "worker_last_name", "status", "worker_cos_number", "visa_type"],
      limit: 500,
      order: [["created_at", "DESC"]],
    })
  );
  res.json({ status: "success", count: data.length, data });
}));

// ── GET /api/v1/usage ────────────────────────────────────────────────────────
router.get("/usage", requireScope("usage:read"), safe(async (req, res) => {
  const { getUsageSummary } = await import("../../../services/usageMeter.service.js");
  const summary = await getUsageSummary(req.apiOrganisation.id);
  res.json({ status: "success", data: summary });
}));

// ── GET /api/v1/openapi.json ─────────────────────────────────────────────────
router.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.0.3",
    info: {
      title: "EPiC CMS Public API",
      version: "1.0.0",
      description: "REST API for EPiC immigration CMS — tenant integrations and automations.",
      contact: { name: "EPiC Support", email: "support@epiccms.com" },
    },
    servers: [{ url: "/api/v1", description: "Public API v1" }],
    security: [{ BearerApiKey: [] }],
    components: {
      securitySchemes: {
        BearerApiKey: { type: "http", scheme: "bearer", bearerFormat: "API Key", description: "Prefix: epic_live_ or epic_test_" },
      },
    },
    paths: {
      "/info":         { get: { summary: "Organisation info and active scopes", tags: ["Meta"] } },
      "/cases":        { get: { summary: "List cases (last 200)", tags: ["Cases"], security: [{ BearerApiKey: [] }] } },
      "/cases/{id}":   { get: { summary: "Get a single case", tags: ["Cases"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }] } },
      "/workers":      { get: { summary: "List sponsored workers", tags: ["Workers"] } },
      "/usage":        { get: { summary: "Current period usage summary", tags: ["Usage"] } },
    },
  });
});

export default router;
