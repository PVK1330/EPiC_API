import { z } from "zod";
import ApiResponse from "../utils/apiResponse.js";
import logger from "../utils/logger.js";

/**
 * Copy `source`'s enumerable keys onto `target` in place, removing keys that are
 * no longer present. Used so we can update getter-only req.query / req.params
 * without reassigning the property itself.
 */
const replaceInPlace = (target, source) => {
  if (!target || typeof target !== "object") return;
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  for (const key of Object.keys(source)) {
    target[key] = source[key];
  }
};

/**
 * Validates request data (body, query, params) against a Zod schema.
 *
 * Express 5 makes req.query a read-only getter — we must NOT assign to it.
 * Instead we attach req.validated = { body, query, params } for controllers
 * to use, and only mutate req.body / req.params (which remain writable).
 *
 * @param {z.ZodSchema} schema
 */
export const validate = (schema, schemaName = null) => async (req, res, next) => {
  logger.info({
    url: req.originalUrl,
    method: req.method,
    schema: schemaName || schema?.description || schema?.name || 'unknown',
    bodyKeys: Object.keys(req.body || {}),
  });
  try {
    const parsed = await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    // Update req with sanitized data. req.query (and sometimes req.params) are
    // getter-only in Express 5 / recent Node, so mutate them in place instead of
    // reassigning the property.
    if (parsed.body) req.body = parsed.body;
    if (parsed.query) replaceInPlace(req.query, parsed.query);
    if (parsed.params) replaceInPlace(req.params, parsed.params);

    // Provide strict validated object
    // req.body and req.params are writable — update with sanitised values
    if (parsed.body) req.body = parsed.body;
    if (parsed.params) req.params = parsed.params;
    // NOTE: req.query is read-only in Express 5 — do NOT assign to it.
    // Controllers must read query params from req.validated.query instead.

    // Strict validated object available to all controllers
    req.validated = {
      body: parsed.body || {},
      query: parsed.query || {},
      params: parsed.params || {},
    };

    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Zod v4 renamed ZodError.errors -> ZodError.issues. Fall back across
      // versions so a validation failure never crashes the error handler itself.
      const issues = error.issues ?? error.errors ?? [];
      const errors = issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      const schemaLabel = schemaName || schema?.constructor?.name || 'unknown';
      req.log?.warn({
        route: req.originalUrl,
        method: req.method,
        bodyKeys: Array.isArray(req.body) ? [] : Object.keys(req.body || {}),
        schema: schemaLabel,
        validationErrors: errors,
      }, 'request validation failed');
      return ApiResponse.validationError(res, "Validation failed", errors);
    }
    return ApiResponse.error(res, "Internal validation error", 500, error);
  }
};
