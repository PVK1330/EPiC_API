/**
 * Redis client — optional. When REDIS_URL is not set the module exports null
 * and callers fall back to in-memory or no-cache behaviour.
 *
 * Week 9 Task 6: Horizontal scaling — Redis for session/cache.
 *
 * Install: npm install ioredis
 * Set env:  REDIS_URL=redis://localhost:6379
 */
import logger from "../utils/logger.js";

let redisClient = null;

async function createRedisClient() {
  if (!process.env.REDIS_URL) {
    logger.info("REDIS_URL not set — Redis disabled, using in-memory fallback");
    return null;
  }

  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });

    await client.connect().catch(() => {});

    client.on("connect", () => logger.info("Redis connected"));
    client.on("error", (err) => logger.warn({ err }, "Redis error"));
    client.on("close", () => logger.info("Redis connection closed"));

    return client;
  } catch (err) {
    logger.warn({ err }, "Redis init failed — falling back to no-cache mode");
    return null;
  }
}

export async function initRedis() {
  redisClient = await createRedisClient();
  return redisClient;
}

export function getRedis() {
  return redisClient;
}

export default { initRedis, getRedis };
