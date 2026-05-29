import EventEmitter from 'events';

class EventBus extends EventEmitter {}

// Create a singleton instance
const eventBus = new EventBus();

// Optional: increase max listeners if the app has many parallel listeners
eventBus.setMaxListeners(50);

export default eventBus;
