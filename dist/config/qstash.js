import { Client } from '@upstash/qstash';
import { logger } from '../utils/logger.js';
export const qstash = new Client({
    token: process.env.QSTASH_TOKEN || '',
});
export var JobType;
(function (JobType) {
    JobType["PROCESS_KNOWLEDGE_ITEM"] = "process-knowledge-item";
    JobType["SCRAPE_CONTENT"] = "scrape-content";
    JobType["GENERATE_SUMMARY"] = "generate-summary";
    JobType["GENERATE_EMBEDDING"] = "generate-embedding";
    JobType["EXTRACT_TAGS"] = "extract-tags";
    JobType["PROCESS_CHAT"] = "process-chat";
})(JobType || (JobType = {}));
export const QUEUE_CONFIG = {
    SCRAPE: {
        retries: 3,
        delay: 0,
    },
    SUMMARIZE: {
        retries: 2,
        delay: 0,
    },
    EMBED: {
        retries: 2,
        delay: 0,
    },
    TAG: {
        retries: 2,
        delay: 0,
    },
    CHAT: {
        retries: 1,
        delay: 0,
    },
};
// Paths QStash delivers jobs back to. Kept here so the publisher (queue.service)
// and the signature verifier (qstash.middleware) always agree on the exact URL.
export const JOB_PATHS = {
    [JobType.PROCESS_KNOWLEDGE_ITEM]: '/api/v1/jobs/process-knowledge-item',
    [JobType.SCRAPE_CONTENT]: '/api/v1/jobs/scrape-content',
    [JobType.GENERATE_SUMMARY]: '/api/v1/jobs/generate-summary',
    [JobType.GENERATE_EMBEDDING]: '/api/v1/jobs/generate-embedding',
    [JobType.EXTRACT_TAGS]: '/api/v1/jobs/extract-tags',
    [JobType.PROCESS_CHAT]: '/api/v1/jobs/process-chat',
};
// How long QStash waits for the worker to finish before treating it as a failure.
// The full pipeline is a scrape plus three Gemini calls, so it needs minutes, not seconds.
export const JOB_TIMEOUT = '300s';
// QStash delivers over the public internet, so it can never reach a loopback address.
const UNREACHABLE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
/**
 * Public base URL QStash should deliver jobs to, or '' when it is unusable
 * (unset, malformed, or pointing at loopback as it does in local dev).
 */
export function getWorkerBaseUrl() {
    const raw = process.env.WORKER_BASE_URL?.trim();
    if (!raw)
        return '';
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        logger.warn(`WORKER_BASE_URL is not a valid URL, ignoring: ${raw}`);
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        logger.warn(`WORKER_BASE_URL must be http(s), ignoring: ${raw}`);
        return '';
    }
    if (UNREACHABLE_HOSTS.has(parsed.hostname))
        return '';
    return raw.replace(/\/+$/, '');
}
/** Absolute URL QStash calls for a given job, or '' if no reachable worker is configured. */
export function jobUrl(job) {
    const base = getWorkerBaseUrl();
    return base ? `${base}${JOB_PATHS[job]}` : '';
}
/**
 * 'qstash' runs jobs as durable, retried background jobs.
 * 'inline' runs them in this process — the local-dev fallback, since QStash
 * cannot call back into localhost. Override with QUEUE_DRIVER.
 */
export function getQueueDriver() {
    const forced = process.env.QUEUE_DRIVER?.trim().toLowerCase();
    if (forced === 'inline')
        return 'inline';
    if (forced === 'qstash') {
        if (process.env.QSTASH_TOKEN && getWorkerBaseUrl())
            return 'qstash';
        logger.warn('QUEUE_DRIVER=qstash but QSTASH_TOKEN or a publicly reachable WORKER_BASE_URL is missing; falling back to inline');
        return 'inline';
    }
    return process.env.QSTASH_TOKEN && getWorkerBaseUrl() ? 'qstash' : 'inline';
}
export function logQueueDriver() {
    const driver = getQueueDriver();
    if (driver === 'qstash') {
        logger.info(`Queue driver: qstash (worker at ${getWorkerBaseUrl()})`);
    }
    else {
        logger.warn('Queue driver: inline (jobs run in this process, no durability or retries)');
    }
}
//# sourceMappingURL=qstash.js.map