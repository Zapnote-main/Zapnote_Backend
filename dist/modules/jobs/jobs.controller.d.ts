import { Request, Response } from 'express';
/**
 * QStash delivery endpoint for the content pipeline.
 *
 * Status codes are the retry protocol, so they matter more than the body:
 *   2xx -> settled, QStash stops.
 *   5xx -> QStash redelivers with backoff until retries are exhausted.
 */
export declare function processKnowledgeItemJob(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=jobs.controller.d.ts.map