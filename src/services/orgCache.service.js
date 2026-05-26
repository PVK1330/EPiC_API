import { LRUCache } from "lru-cache";

const orgCache = new LRUCache({
  max: 200,
  ttl: 5 * 60 * 1000,
});

const permCache = new LRUCache({
  max: 500,
  ttl: 2 * 60 * 1000,
});

export function getCachedOrg(orgId) {
  return orgCache.get(orgId) ?? null;
}

export function setCachedOrg(orgId, data) {
  orgCache.set(orgId, data);
}

export function getCachedPermissions(cacheKey) {
  return permCache.get(cacheKey) ?? null;
}

export function setCachedPermissions(cacheKey, permissions) {
  permCache.set(cacheKey, permissions);
}

export function invalidateOrgCache(orgId) {
  orgCache.delete(orgId);
}

export function invalidatePermCache(prefix) {
  for (const key of permCache.keys()) {
    if (String(key).startsWith(String(prefix))) {
      permCache.delete(key);
    }
  }
}
