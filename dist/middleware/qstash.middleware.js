import { Receiver } from '@upstash/qstash';
import { logger } from '../utils/logger.js';
import { getWorkerBaseUrl } from '../config/qstash.js';
/**
 * The URL QStash signed, rebuilt from WORKER_BASE_URL rather than from the
 * incoming request. Behind a proxy req.protocol/host do not reflect the public
 * URL, so deriving it from the same value the publisher used is what makes the
 * two sides agree.
 */
function expectedUrl(req) {
    const base = getWorkerBaseUrl();
    if (!base)
        return '';
    const path = req.originalUrl.split('?')[0] ?? req.path;
    return `${base}${path}`;
}
export const verifyQStashSignature = async (req, res, next) => {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY || '';
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY || '';
    if (!currentSigningKey && !nextSigningKey) {
        // Fail closed in production: an unsigned worker endpoint lets anyone run jobs.
        if (process.env.NODE_ENV === 'production') {
            logger.error('QStash signing keys are not configured; refusing job request');
            return res.status(500).json({ error: 'Worker not configured' });
        }
        logger.warn('Skipping QStash verification (no signing keys, non-production)');
        return next();
    }
    const header = req.headers['upstash-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
        logger.warn('Missing QStash signature');
        return res.status(401).json({ error: 'Missing signature' });
    }
    // Verification is over the exact bytes QStash signed. Re-serialising req.body
    // would reorder or reformat it and never match, so require the captured raw
    // body from the express.json verify hook in app.ts.
    if (typeof req.rawBody !== 'string') {
        logger.error('Raw body unavailable for QStash verification; the express.json verify hook must run before this route');
        return res.status(500).json({ error: 'Cannot verify signature' });
    }
    const receiver = new Receiver({
        currentSigningKey,
        nextSigningKey,
    });
    const url = expectedUrl(req);
    try {
        const isValid = await receiver.verify({
            signature,
            body: req.rawBody,
            // Omitted when unknown, which disables the URL claim check rather than
            // rejecting every job.
            ...(url ? { url } : {}),
            clockTolerance: 5,
        });
        if (!isValid) {
            logger.warn(`Invalid QStash signature${url ? ` (expected url ${url})` : ''}`);
            return res.status(401).json({ error: 'Invalid signature' });
        }
        next();
    }
    catch (error) {
        logger.error(`QStash verification error${url ? ` (expected url ${url})` : ''}:`, error);
        return res.status(401).json({ error: 'Invalid signature' });
    }
};
//# sourceMappingURL=qstash.middleware.js.map