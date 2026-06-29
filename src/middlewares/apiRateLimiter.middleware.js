import rateLimit from "express-rate-limit";

/**
 * Public API rate limiter — 1000 requests per 15 minutes per API key.
 * Falls back to IP when no API key is present on the request.
 */
export const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.apiKey?.key_prefix
      ? `apikey:${req.apiKey.key_prefix}:${req.apiOrganisation?.id}`
      : `ip:${req.ip}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      status: "error",
      message: "Rate limit exceeded. Maximum 1000 requests per 15 minutes.",
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Stricter limiter for write operations — 200 per 15 minutes.
 */
export const publicApiWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.apiKey?.key_prefix
      ? `apikey:${req.apiKey.key_prefix}:write`
      : `ip:${req.ip}:write`;
  },
  handler: (req, res) => {
    res.status(429).json({
      status: "error",
      message: "Write rate limit exceeded. Maximum 200 write requests per 15 minutes.",
    });
  },
});
