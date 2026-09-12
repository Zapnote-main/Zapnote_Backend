/** How many times QStash redelivers this job after the first attempt. */
export declare const PROCESS_ITEM_RETRIES: 3;
export type JobOutcome = {
    status: 'completed';
} | {
    status: 'skipped';
    reason: string;
} | {
    status: 'failed';
    error: string;
};
/**
 * Runs the full enrichment pipeline for one knowledge item.
 *
 * Safe to call more than once for the same item: each step is skipped when its
 * output is already in the database, so a QStash redelivery resumes where the
 * previous attempt stopped instead of re-paying for the scrape and the Gemini calls.
 *
 * Throws when the caller should retry — the worker turns that into a non-2xx so
 * QStash redelivers. Returns an outcome when the job is settled and must not be
 * retried.
 */
export declare function processKnowledgeItem(knowledgeItemId: string, options?: {
    attempt?: number;
    maxAttempts?: number;
}): Promise<JobOutcome>;
/**
 * Hands item processing to the background queue.
 *
 * With QStash configured this returns as soon as the job is durably accepted and
 * the work happens in a separate, retried request driven by QStash. Without it,
 * the pipeline runs in this process as before.
 */
export declare function enqueueContentProcessing(knowledgeItemId: string): Promise<void>;
//# sourceMappingURL=queue.service.d.ts.map