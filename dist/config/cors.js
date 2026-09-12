import { logger } from '../utils/logger.js';
import { ForbiddenError } from '../utils/error.js';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
/**
 * Origins allowed in every environment. ADDITIONAL_ORIGINS is a comma-separated
 * list, for preview deployments and the like.
 */
const configuredOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.ADDITIONAL_ORIGINS ?? '').split(','),
]
    .map((o) => o?.trim())
    .filter((o) => Boolean(o));
const isProduction = process.env.NODE_ENV === 'production';
/**
 * Single source of truth for CORS, shared by the Express app and Socket.IO so the
 * two can never disagree about who may connect.
 *
 * In development any loopback origin is accepted regardless of port: the dev server
 * does not always get the port it asks for (another process may hold it), and hard
 * coding one meant the API silently rejected the frontend whenever that happened.
 * Production stays restricted to the configured origins.
 */
export function isAllowedOrigin(origin) {
    // No Origin header: same-origin requests, curl, and server-to-server callers
    // such as QStash delivering a job.
    if (!origin)
        return true;
    if (configuredOrigins.includes(origin))
        return true;
    if (!isProduction) {
        try {
            const { hostname } = new URL(origin);
            if (LOCAL_HOSTNAMES.has(hostname))
                return true;
        }
        catch {
            return false;
        }
    }
    return false;
}
export function logCorsPolicy() {
    const configured = configuredOrigins.length ? configuredOrigins.join(', ') : '(none configured)';
    if (isProduction) {
        logger.info(`CORS: allowing ${configured}`);
    }
    else {
        logger.info(`CORS: allowing ${configured} plus any localhost port (development)`);
    }
}
/** Origin checker in the shape the `cors` package and Socket.IO both accept. */
export function corsOriginCheck(origin, callback) {
    if (isAllowedOrigin(origin)) {
        return callback(null, true);
    }
    logger.warn(`CORS blocked: ${origin}`);
    // A blocked origin is a rejected request, not a server fault: without a typed
    // error the handler reported every one of these as a 500.
    callback(new ForbiddenError(`CORS blocked: ${origin}`));
}
//# sourceMappingURL=cors.js.map