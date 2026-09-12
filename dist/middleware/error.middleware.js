import { AppError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
/**
 * Express middleware signals client errors by setting `status`/`statusCode` on the
 * error — body-parser uses 400 for malformed JSON, for example. Without this a bad
 * request body was reported as a 500, which reads as "the server broke" in logs and
 * tells clients to retry something that will never succeed.
 */
function clientErrorStatus(err) {
    const status = err?.status ?? err?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
        return status;
    }
    return null;
}
export function errorHandler(err, req, res, next) {
    logger.error('Error:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
    });
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }
    const status = clientErrorStatus(err);
    if (status) {
        return res.status(status).json({
            success: false,
            message: err.message,
        });
    }
    return res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
}
//# sourceMappingURL=error.middleware.js.map