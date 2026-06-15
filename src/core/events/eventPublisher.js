import eventBus from './eventBus.js';
import logger from '../../utils/logger.js';

/**
 * Publishes an event to the system event bus.
 * Controllers should strictly use this service rather than direct notifications.
 * 
 * Always returns a resolved Promise so callers can safely chain
 * `.then()/.catch()` for fire-and-forget publishing (event emission itself is
 * synchronous and never throws — failures are logged here).
 *
 * @param {string} eventName - From EVENTS registry
 * @param {Object} payload - The event data payload
 * @param {Object} context - Optional context (like req.user, tenantDb, etc.)
 * @returns {Promise<void>}
 */
export const publishEvent = (eventName, payload, context = {}) => {
  try {
    eventBus.emit(eventName, { ...payload, __context: context });
  } catch (error) {
    logger.error({ err: error }, `[EventPublisher] Failed to publish event: ${eventName}`);
  }
  return Promise.resolve();
};

export default {
  publish: publishEvent
};
