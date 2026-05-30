import { z } from 'zod';
import ApiResponse from '../utils/apiResponse.js';

/**
 * Validates request data (body, query, params) against a Zod schema.
 * Replaces req.body, req.query, and req.params with the sanitized/parsed data.
 * Also attaches req.validated = { body, query, params } for strict usage.
 * 
 * @param {z.ZodSchema} schema
 */
export const validate = (schema) => async (req, res, next) => {
  try {
    const parsed = await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    // Update req with sanitized data
    req.body = parsed.body || req.body;
    req.query = parsed.query || req.query;
    req.params = parsed.params || req.params;

    // Provide strict validated object
    req.validated = {
      body: parsed.body || {},
      query: parsed.query || {},
      params: parsed.params || {},
    };

    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return ApiResponse.validationError(res, 'Validation failed', errors);
    }
    return ApiResponse.error(res, 'Internal validation error', 500, error);
  }
};
