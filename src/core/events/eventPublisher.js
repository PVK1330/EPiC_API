import eventBus from './eventBus.js';

/**
 * Publishes an event to the system event bus.
 * Controllers should strictly use this service rather than direct notifications.
 * 
 * @param {string} eventName - From EVENTS registry
 * @param {Object} payload - The event data payload
 * @param {Object} context - Optional context (like req.user, tenantDb, etc.)
 */
export const publishEvent = (eventName, payload, context = {}) => {
  try {
    eventBus.emit(eventName, { ...payload, __context: context });
  } catch (error) {
    console.error(`[EventPublisher] Failed to publish event: ${eventName}`, error);
  }
};

export default {
  publish: publishEvent
};
