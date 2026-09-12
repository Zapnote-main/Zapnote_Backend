import { Redis } from '@upstash/redis';
export declare const redis: Redis;
export declare function testRedisConnection(): Promise<void>;
export declare const CACHE_TTL: {
    readonly USER_SESSION: number;
    readonly USER_PROFILE: number;
    readonly WORKSPACE_PERMISSIONS: number;
    readonly WORKSPACE_LIST: number;
    readonly WORKSPACE_ITEMS: number;
    readonly SEARCH_RESULTS: number;
    readonly EMBEDDINGS: number;
    readonly RATE_LIMIT: number;
    readonly USER_EXISTS: number;
};
export declare const CacheKeys: {
    userProfile: (userId: string) => string;
    userWorkspaces: (userId: string) => string;
    userExists: (userId: string) => string;
    workspace: (workspaceId: string) => string;
    workspaceMembers: (workspaceId: string) => string;
    workspacePermissions: (userId: string, workspaceId: string) => string;
    workspaceItemsVersion: (workspaceId: string) => string;
    workspaceItems: (workspaceId: string, version: number, variant: string) => string;
    searchResults: (query: string, workspaceId: string) => string;
    embedding: (text: string) => string;
    rateLimit: (userId: string, action: string) => string;
};
export declare const cache: {
    /** Returns null on a miss *or* on any Redis failure. */
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
    /**
     * Current invalidation generation for a key space. A missing or unreadable
     * counter reads as 0, so a Redis outage simply means cache misses.
     */
    version(key: string): Promise<number>;
    /**
     * Invalidates every key built from this counter in one command, which is how
     * we drop all cached variants of a list without enumerating them.
     */
    bump(key: string): Promise<void>;
    /** Invalidation must never fail a request that already did its work. */
    del(...keys: string[]): Promise<void>;
};
/**
 * Parses a cached value that may come back as a JSON string or an already-decoded
 * object, depending on how it was written.
 */
export declare function parseCached<T>(cached: unknown): T;
//# sourceMappingURL=redis.d.ts.map