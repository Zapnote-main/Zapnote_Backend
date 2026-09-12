import { redis, CacheKeys } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { RateLimitError } from "../utils/error.js";
export function rateLimit(action, limit, windowSeconds = 3600) {
    return async (req, res, next) => {
        const userId = req.userId;
        const key = CacheKeys.rateLimit(userId, action);
        let curr;
        try {
            curr = await redis.incr(key);
            if (curr === 1) {
                await redis.expire(key, windowSeconds);
            }
        }
        catch (error) {
            // Fail open. The counter lives only in Redis, so when Redis is down there
            // is nothing to count against, and the alternative is rejecting every
            // write in the app because the rate limiter cannot do its bookkeeping.
            logger.warn(`Rate limit check skipped for ${action} (redis unavailable):`, error);
            return next();
        }
        try {
            if (curr > limit) {
                throw new RateLimitError(`Rate limit exceeded. Max ${limit} requests per ${windowSeconds}s`);
            }
            res.setHeader('X-RateLimit-Limit', limit);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - curr));
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
//# sourceMappingURL=ratelimit.middleware.js.map