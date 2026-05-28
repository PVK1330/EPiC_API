/**
 * Centralised structured logger powered by Pino.
 *
 * Features:
 * - JSON output in production, pretty-printed in development
 * - Request ID propagation via AsyncLocalStorage
 * - Automatic redaction of sensitive fields (passwords, tokens, secrets)
 * - ISO-8601 timestamps
 * - Configurable log level via LOG_LEVEL env var
 *
 * Usage:
 *   import logger from '../utils/logger.js';
 *   logger.info({ userId: 42 }, 'User logged in');
 *   logger.error({ err }, 'Database connection failed');
 */

import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

// ── Request ID context ────────────────────────────────────────────────────────
// AsyncLocalStorage is the only reliable way to propagate request-scoped data
// through async call chains without threading it through every function argument.
const requestContext = new AsyncLocalStorage();

/**
 * Store a request ID in the current async context so every downstream log
 * line automatically includes it.
 */
export function setRequestId(id) {
  requestContext.enterWith({ requestId: id });
}

/**
 * Retrieve the request ID from the current async context (if any).
 */
export function getRequestId() {
  return requestContext.getStore()?.requestId;
}

// ── Sensitive field redaction ─────────────────────────────────────────────────
// Pino walks every logged object and censors paths matching these patterns.
// Wildcards (*) match a single path segment; double-wildcards (**) match all.
const REDACT_PATHS = [
  // Authentication
  'password',
  'newPassword',
  'oldPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  'secret',
  'clientSecret',
  'webhookSecret',
  'encryptionKey',
  'otp',
  'totpSecret',

  // HTTP headers
  'authorization',
  'cookie',
  'set-cookie',

  // Personal data
  'ssn',
  'socialSecurityNumber',
  'passportNumber',

  // Nested wildcards — catches body.password, query.token, etc.
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  'headers.authorization',
  'headers.cookie',
  'headers.*authorization*',
  'body.password',
  'body.token',
  'body.secret',

  // Database credentials (just in case)
  'dbPassword',
  'connectionString',
];

// ── Environment-aware configuration ───────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const loggerOptions = {
  level: logLevel,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false, // keep the key but censor the value (easier to debug)
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Serializers let us safely log Error objects
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
};

// ── Development: human-readable output ────────────────────────────────────────
if (!isProduction) {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '{requestId} {msg}',
    },
  };
}

const logger = pino(loggerOptions);

/**
 * Create a child logger with additional bindings.
 * Automatically picks up the current request ID from async context.
 *
 * @example
 *   const log = childLogger({ module: 'auth' });
 *   log.info('Token verified');
 */
export function childLogger(bindings = {}) {
  const reqId = getRequestId();
  if (reqId && !bindings.requestId) {
    bindings.requestId = reqId;
  }
  return logger.child(bindings);
}

export default logger;