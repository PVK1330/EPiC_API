/**
 * Thin caching wrapper.
 * Uses Redis when available, otherwise a simple in-process Map with TTL.
 *
 * Week 9 Task 6 + Week 10 Task 13: Redis caching for hot dashboard queries.
 */
import { getRedis } from "../config/redis.js";
import logger from "../utils/logger.js";

// In-memory fallback store
const memStore = new Map();

function memGet(key) {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return null; }
  return entry.value;
}

function memSet(key, value, ttlSeconds) {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  // Prevent unbounded growth
  if (memStore.size > 5000) {
    const oldest = memStore.keys().next().value;
    memStore.delete(oldest);
  }
}

function memDel(key) { memStore.delete(key); }

export async function cacheGet(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(key);
      return val ? JSON.parse(val) : null;
    } catch (err) {
      logger.warn({ err, key }, "cacheGet Redis error");
    }
  }
  return memGet(key);
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
      return;
    } catch (err) {
      logger.warn({ err, key }, "cacheSet Redis error");
    }
  }
  memSet(key, value, ttlSeconds);
}

export async function cacheDel(key) {
  const redis = getRedis();
  if (redis) {
    try { await redis.del(key); return; } catch {}
  }
  memDel(key);
}

export async function cacheDelPattern(pattern) {
  const redis = getRedis();
  if (redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
      return;
    } catch {}
  }
  // Fallback: delete matching mem keys
  for (const key of memStore.keys()) {
    if (key.includes(pattern.replace("*", ""))) memStore.delete(key);
  }
}

/**
 * Cache-aside helper.
 * Returns cached value or calls loader(), caches result, and returns it.
 */
export async function withCache(key, ttlSeconds, loader) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  const value = await loader();
  if (value !== null && value !== undefined) {
    await cacheSet(key, value, ttlSeconds);
  }
  return value;
}
