import { rateLimit } from 'express-rate-limit';

const getClientIp = (req) => {
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
};

const getTenantSlug = (req) => {
  return req.organisationContext?.organisation?.slug
    || req.organisationContext?.slug
    || 'no-tenant';
};

const buildDownloadKey = (req) => {
  const tenant = getTenantSlug(req);
  const ip = getClientIp(req);
  const user = req.user?.id || 'anonymous';
  return `download:${tenant}:${user}:${ip}`;
};

const downloadRateLimitHandler = (req, res) => {
  res.status(429).json({
    status: false,
    message: 'Too many download requests. Please try again later.',
  });
};

/**
 * Document download limiter — prevents bulk-scraping and bandwidth abuse (BUG-013).
 * 100 downloads per 15 minutes per (tenant, user, IP).
 */
export const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  keyGenerator: buildDownloadKey,
  handler: downloadRateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});
