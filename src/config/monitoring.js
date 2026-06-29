/**
 * Monitoring & error tracking — Sentry integration.
 * Week 10 Task 14: Production SaaS deployment with Sentry configured.
 *
 * Set env: SENTRY_DSN=https://xxx@sentry.io/xxx
 * Install: npm install @sentry/node
 */
import logger from "../utils/logger.js";

let Sentry = null;

export async function initMonitoring(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("SENTRY_DSN not set — Sentry disabled");
    return;
  }

  try {
    const SentryModule = await import("@sentry/node");
    Sentry = SentryModule.default || SentryModule;

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app }),
      ],
    });

    // Must be first middleware
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());

    logger.info("Sentry monitoring initialised");
  } catch (err) {
    logger.warn({ err }, "Sentry init failed — continuing without monitoring");
  }
}

export function getSentryErrorHandler() {
  if (!Sentry) return null;
  return Sentry.Handlers.errorHandler();
}

export function captureException(err, context = {}) {
  if (Sentry) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
      Sentry.captureException(err);
    });
  } else {
    logger.error({ err, ...context }, "Unhandled exception");
  }
}
