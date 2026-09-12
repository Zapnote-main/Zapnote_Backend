import { Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import {
  processKnowledgeItem,
  PROCESS_ITEM_RETRIES,
} from '../../services/queue/queue.service.js';

/**
 * Attempts already made for this message, from the header QStash sets on each
 * redelivery. Absent on the first delivery.
 */
function readAttempt(req: Request): number {
  const raw = req.headers['upstash-retried'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


/**
 * QStash delivery endpoint for the content pipeline.
 *
 * Status codes are the retry protocol, so they matter more than the body:
 *   2xx -> settled, QStash stops.
 *   5xx -> QStash redelivers with backoff until retries are exhausted.
 */
export async function processKnowledgeItemJob(req: Request, res: Response) {
  const knowledgeItemId = (req.body ?? {}).knowledgeItemId;

  // A malformed message will never become valid, so settle it instead of
  // burning the whole retry budget on it.
  if (typeof knowledgeItemId !== 'string' || !knowledgeItemId) {
    logger.warn('Job received without a valid knowledgeItemId, dropping');
    return res.status(200).json({
      success: false,
      message: 'Invalid payload, dropped',
    });
  }

  const attempt = readAttempt(req);

  try {
    const outcome = await processKnowledgeItem(knowledgeItemId, {
      attempt,
      maxAttempts: PROCESS_ITEM_RETRIES,
    });

    return res.status(200).json({
      success: outcome.status !== 'failed',
      ...outcome,
    });
  } catch (error: any) {
    logger.warn(
      `Job for ${knowledgeItemId} failed on attempt ${attempt + 1}, asking QStash to retry`
    );
    return res.status(500).json({
      success: false,
      message: error?.message || 'Job failed',
    });
  }
}
