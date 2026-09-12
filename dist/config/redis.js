import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    // The default is 5 retries with exponential backoff, which turns one unreachable
    // Redis into several seconds of added latency on every request that touches it.
    retry: {
        retries: 1,
        backoff: () => 150,
    },
});
export async function testRedisConnection() {
    try {
        await redis.ping();
        console.log('Redis connected');
    }
    catch (error) {
        console.error('Redis connection failed:', error);
    }
}
export const CACHE_TTL = {
    USER_SESSION: 60 * 60 * 24 * 7, // 7 days
    USER_PROFILE: 60 * 60, // 1 hour
    WORKSPACE_PERMISSIONS: 60 * 15, // 15 minutes
    WORKSPACE_LIST: 60 * 30, // 30 minutes
    WORKSPACE_ITEMS: 60 * 5, // 5 minutes
    SEARCH_RESULTS: 60 * 10, // 10 minutes
    EMBEDDINGS: 60 * 60 * 24, // 24 hours
    RATE_LIMIT: 60 * 60, // 1 hour
    USER_EXISTS: 60 * 60 * 24, // 24 hours
};
export const CacheKeys = {
    userProfile: (userId) => `user:${userId}`,
    userWorkspaces: (userId) => `user:${userId}:workspaces`,
    userExists: (userId) => `user:${userId}:exists`,
    workspace: (workspaceId) => `workspace:${workspaceId}`,
    workspaceMembers: (workspaceId) => `workspace:${workspaceId}:members`,
    workspacePermissions: (userId, workspaceId) => `perm:${userId}:${workspaceId}`,
    workspaceItemsVersion: (workspaceId) => `workspace:${workspaceId}:items:v`,
    workspaceItems: (workspaceId, version, variant) => `workspace:${workspaceId}:items:v${version}:${hashString(variant)}`,
    searchResults: (query, workspaceId) => `search:${workspaceId}:${hashString(query)}`,
    embedding: (text) => `embed:${hashString(text)}`,
    rateLimit: (userId, action) => `ratelimit:${userId}:${action}`,
};
function hashString(text) {
    return crypto.createHash('md5').update(text).digest('hex').slice(0, 16);
}
// One shared place where a Redis outage is absorbed.
//
// Reads are the important part: without this, a failed GET propagated out of every
// service and middleware and became a 500 (or a 401 from the auth middleware), so an
// expired Upstash token took the whole API down instead of merely making it slower.
// Treating a failure as a miss keeps the cache an optimisation rather than a
// dependency. Use `redis` directly only when you need a command these do not cover.
export const cache = {
    /** Returns null on a miss *or* on any Redis failure. */
    async get(key) {
        try {
            return await redis.get(key);
        }
        catch (error) {
            logger.warn(`Cache read failed for ${key}, treating as miss:`, error);
            return null;
        }
    },
    async set(key, value, ttlSeconds) {
        try {
            await redis.set(key, value, { ex: ttlSeconds });
        }
        catch (error) {
            logger.warn(`Cache write failed for ${key}:`, error);
        }
    },
    /**
     * Current invalidation generation for a key space. A missing or unreadable
     * counter reads as 0, so a Redis outage simply means cache misses.
     */
    async version(key) {
        const raw = await cache.get(key);
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    },
    /**
     * Invalidates every key built from this counter in one command, which is how
     * we drop all cached variants of a list without enumerating them.
     */
    async bump(key) {
        try {
            await redis.incr(key);
        }
        catch (error) {
            logger.warn(`Cache version bump failed for ${key}:`, error);
        }
    },
    /** Invalidation must never fail a request that already did its work. */
    async del(...keys) {
        if (keys.length === 0)
            return;
        try {
            await redis.del(...keys);
        }
        catch (error) {
            logger.warn(`Cache invalidation failed for ${keys.join(', ')}:`, error);
        }
    },
};
/**
 * Parses a cached value that may come back as a JSON string or an already-decoded
 * object, depending on how it was written.
 */
export function parseCached(cached) {
    if (typeof cached === 'string') {
        return JSON.parse(cached);
    }
    return cached;
}
//# sourceMappingURL=redis.js.map