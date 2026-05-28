import { rateLimit } from 'express-rate-limit';

const getClientIp = (req) => {
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
};

const getTenantSlug = (req) => {
  return req.organisationContext?.organisation?.slug
    || req.organisationContext?.slug
    || 'no-tenant';
};

const buildUploadKey = (req) => {
  const tenant = getTenantSlug(req);
  const ip = getClientIp(req);
  const user = req.user?.id || 'anonymous';
  return `upload:${tenant}:${user}:${ip}`;
};

const uploadRateLimitHandler = (req, res) => {
  res.status(429).json({
    status: false,
    message: 'Too many file uploads. Please try again later.',
  });
};

/**
 * Standard upload limiter to prevent DoS via disk exhaustion and spamming.
 * Limits users to 20 uploads per 10 minutes.
 */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 uploads per window
  keyGenerator: buildUploadKey,
  handler: uploadRateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});
