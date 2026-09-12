import { Client } from '@upstash/qstash';
export declare const qstash: Client;
export declare enum JobType {
    PROCESS_KNOWLEDGE_ITEM = "process-knowledge-item",
    SCRAPE_CONTENT = "scrape-content",
    GENERATE_SUMMARY = "generate-summary",
    GENERATE_EMBEDDING = "generate-embedding",
    EXTRACT_TAGS = "extract-tags",
    PROCESS_CHAT = "process-chat"
}
export declare const QUEUE_CONFIG: {
    readonly SCRAPE: {
        readonly retries: 3;
        readonly delay: 0;
    };
    readonly SUMMARIZE: {
        readonly retries: 2;
        readonly delay: 0;
    };
    readonly EMBED: {
        readonly retries: 2;
        readonly delay: 0;
    };
    readonly TAG: {
        readonly retries: 2;
        readonly delay: 0;
    };
    readonly CHAT: {
        readonly retries: 1;
        readonly delay: 0;
    };
};
export declare const JOB_PATHS: Record<JobType, string>;
export declare const JOB_TIMEOUT = "300s";
/**
 * Public base URL QStash should deliver jobs to, or '' when it is unusable
 * (unset, malformed, or pointing at loopback as it does in local dev).
 */
export declare function getWorkerBaseUrl(): string;
/** Absolute URL QStash calls for a given job, or '' if no reachable worker is configured. */
export declare function jobUrl(job: JobType): string;
export type QueueDriver = 'qstash' | 'inline';
/**
 * 'qstash' runs jobs as durable, retried background jobs.
 * 'inline' runs them in this process — the local-dev fallback, since QStash
 * cannot call back into localhost. Override with QUEUE_DRIVER.
 */
export declare function getQueueDriver(): QueueDriver;
export declare function logQueueDriver(): void;
//# sourceMappingURL=qstash.d.ts.map