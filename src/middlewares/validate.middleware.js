import { z } from 'zod';
import ApiResponse from '../utils/apiResponse.js';

/**
 * Validates request data (body, query, params) against a Zod schema.
 *
 * Express 5 makes req.query a read-only getter — we must NOT assign to it.
 * Instead we attach req.validated = { body, query, params } for controllers
 * to use, and only mutate req.body / req.params (which remain writable).
 *
 * @param {z.ZodSchema} schema
 */
export const validate = (schema) => async (req, res, next) => {
  try {
    const parsed = await schema.parseAsync({
      body:   req.body,
      query:  req.query,
      params: req.params,
    });

    // req.body and req.params are writable — update with sanitised values
    if (parsed.body)   req.body   = parsed.body;
    if (parsed.params) req.params = parsed.params;
    // NOTE: req.query is read-only in Express 5 — do NOT assign to it.
    // Controllers must read query params from req.validated.query instead.

    // Strict validated object available to all controllers
    req.validated = {
      body:   parsed.body   || {},
      query:  parsed.query  || {},
      params: parsed.params || {},
    };

    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return ApiResponse.validationError(res, 'Validation failed', errors);
    }
    return ApiResponse.error(res, 'Internal validation error', 500, error);
  }
};
