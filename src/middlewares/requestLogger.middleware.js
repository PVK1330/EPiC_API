/**
 * Request logging middleware using Pino.
 *
 * Injects a unique request ID into every incoming HTTP request, stores it in
 * AsyncLocalStorage so all downstream logger calls automatically include it,
 * and logs a summary line on response finish.
 *
 * Attaches to `req`:
 *   req.requestId  — UUID v4 (also set as X-Request-Id response header)
 *   req.log        — pre-configured child logger bound to this request
 *
 * Sensitive information (cookies, auth headers) is automatically redacted by
 * the logger's redaction rules. The access log line is intentionally terse:
 * method, url, status, response time (ms), and request ID.
 */

import { randomUUID } from 'crypto';
import { setRequestId } from '../utils/logger.js';
import logger from '../utils/logger.js';

/**
 * Express middleware that wraps every request in an AsyncLocalStorage context
 * so all downstream log calls carry the same request ID.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestContextMiddleware(req, res, next) {
  // S-30 fix: validate client-supplied X-Request-Id is a proper UUID before
  // accepting it. An arbitrary string would be embedded in every log line for
  // that request, enabling log injection / SIEM pollution.
  const incoming = req.headers['x-request-id'];
  const requestId = (incoming && UUID_RE.test(incoming)) ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Store in async context so child loggers pick it up automatically
  setRequestId(requestId);

  // Pre-built child logger for this request — use as req.log.info(...)
  req.log = logger.child({ requestId, method: req.method, url: req.originalUrl });

  next();
}

/**
 * Express middleware that logs a single structured line per request on finish.
 *
 * Log format (production JSON):
 *   { "level": "info", "msg": "request completed", "method": "GET",
 *     "url": "/api/cases", "status": 200, "responseTime": 42, "requestId": "..." }
 */
export function requestLoggingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - start;
    const responseTime = Number(durationNs) / 1e6; // ns → ms

    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'info';

    logger[level]({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      responseTime: Math.round(responseTime * 100) / 100,
      requestId: req.requestId,
      responseSize: res.getHeader('content-length'),
    }, 'request completed');
  });

  next();
}

export default { requestContextMiddleware, requestLoggingMiddleware };