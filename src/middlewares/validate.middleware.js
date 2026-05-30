import { z } from 'zod';
import ApiResponse from '../utils/apiResponse.js';

/**
 * Copy `source`'s enumerable keys onto `target` in place, removing keys that are
 * no longer present. Used so we can update getter-only req.query / req.params
 * without reassigning the property itself.
 */
const replaceInPlace = (target, source) => {
  if (!target || typeof target !== 'object') return;
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  for (const key of Object.keys(source)) {
    target[key] = source[key];
  }
};

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

    // Update req with sanitized data. req.query (and sometimes req.params) are
    // getter-only in Express 5 / recent Node, so mutate them in place instead of
    // reassigning the property.
    if (parsed.body) req.body = parsed.body;
    if (parsed.query) replaceInPlace(req.query, parsed.query);
    if (parsed.params) replaceInPlace(req.params, parsed.params);

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
