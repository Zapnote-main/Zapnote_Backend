import { logger } from '../../utils/logger.js';
import prisma from '../../config/db.js';
import { scrapeContent } from '../scrapper/scraper.service.js';
import { classifyContent } from '../ai/classifier.service.js';
import { generateSummary } from '../ai/summarizer.service.js';
import { generateEmbeddingCached } from '../ai/embedding.service.js';
import { extractTags } from '../ai/tagger.service.js';
import { cache, CacheKeys } from '../../config/redis.js';
import { GEMINI_MODELS } from '../../config/gemini.js';
import { socketEmit } from '../../config/socket.js';
import { qstash, getQueueDriver, jobUrl, JobType, JOB_TIMEOUT, QUEUE_CONFIG, } from '../../config/qstash.js';
import crypto from 'crypto';
const normalizeTagName = (tagName) => tagName?.toLowerCase().trim();
/** How many times QStash redelivers this job after the first attempt. */
export const PROCESS_ITEM_RETRIES = QUEUE_CONFIG.SCRAPE.retries;
async function invalidateWorkspaceItems(workspaceId) {
    // Bumps the list version, which drops every cached page/filter variant at once.
    // cache.bump swallows Redis failures: a cold cache is never a reason to fail a
    // job that already did its work.
    await cache.bump(CacheKeys.workspaceItemsVersion(workspaceId));
}
async function recordFailure(knowledgeItemId, message, terminal) {
    try {
        await prisma.knowledgeItem.update({
            where: { id: knowledgeItemId },
            // A non-terminal failure stays PROCESSING: a retry is still pending, so the
            // UI should keep showing it as in-flight rather than flipping to FAILED.
            data: terminal
                ? { status: 'FAILED', errorMessage: message }
                : { errorMessage: message },
        });
    }
    catch (error) {
        logger.error(`Could not record failure for ${knowledgeItemId}:`, error);
    }
}
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
export async function processKnowledgeItem(knowledgeItemId, options = {}) {
    const attempt = options.attempt ?? 0;
    const maxAttempts = options.maxAttempts ?? 0;
    const isFinalAttempt = attempt >= maxAttempts;
    logger.info(`Starting pipeline for item: ${knowledgeItemId} (attempt ${attempt + 1}/${maxAttempts + 1})`);
    // Captured so the terminal-failure path can notify the workspace as well.
    let workspaceId = null;
    try {
        const item = await prisma.knowledgeItem.findUnique({
            where: { id: knowledgeItemId },
        });
        // Deleted between enqueue and delivery. Settled, not an error.
        if (!item) {
            logger.warn(`Item ${knowledgeItemId} no longer exists, dropping job`);
            return { status: 'skipped', reason: 'item-not-found' };
        }
        // QStash delivers at least once, so a duplicate delivery is normal.
        if (item.status === 'COMPLETED') {
            logger.info(`Item ${knowledgeItemId} already completed, dropping duplicate delivery`);
            return { status: 'skipped', reason: 'already-completed' };
        }
        workspaceId = item.workspaceId;
        await prisma.knowledgeItem.update({
            where: { id: knowledgeItemId },
            data: { status: 'PROCESSING', errorMessage: null },
        });
        // --- Scrape + classify (skipped when an earlier attempt already stored content) ---
        let content = item.scrapedContent ?? '';
        if (content) {
            logger.info(`Reusing scraped content for ${knowledgeItemId} (${content.length} chars)`);
        }
        else {
            logger.info(`Scraping URL: ${item.sourceUrl}`);
            const scrapeResult = await scrapeContent(item.sourceUrl);
            if (!scrapeResult.success || !scrapeResult.data) {
                throw new Error(scrapeResult.error || 'Scraping failed');
            }
            content = scrapeResult.data.content;
            logger.info(`Classifying content...`);
            const contentType = await classifyContent(content, item.sourceUrl);
            await prisma.knowledgeItem.update({
                where: { id: knowledgeItemId },
                data: {
                    scrapedContent: content,
                    contentType,
                    metadata: {
                        ...(scrapeResult.data.metadata || {}),
                        scrapedTitle: scrapeResult.data.title,
                    },
                },
            });
        }
        // --- Summary ---
        let summary = item.summary ?? '';
        if (summary) {
            logger.info(`Reusing existing summary for ${knowledgeItemId}`);
        }
        else {
            logger.info(`Generating summary...`);
            summary = await generateSummary(content, item.userIntent || undefined);
            await prisma.knowledgeItem.update({
                where: { id: knowledgeItemId },
                data: { summary },
            });
        }
        // --- Embedding ---
        const existingEmbedding = await prisma.embedding.findUnique({
            where: { knowledgeItemId },
            select: { id: true },
        });
        if (existingEmbedding) {
            logger.info(`Reusing existing embedding for ${knowledgeItemId}`);
        }
        else {
            logger.info(`Generating embedding...`);
            const textToEmbed = [summary, content.slice(0, 3000)].filter(Boolean).join('\n\n');
            const embedding = await generateEmbeddingCached(textToEmbed);
            const vectorLiteral = `[${embedding.join(',')}]`;
            const embeddingId = crypto.randomUUID();
            await prisma.$executeRaw `
        INSERT INTO "Embedding" ("id", "knowledgeItemId", "vector", "model")
        VALUES (${embeddingId}, ${knowledgeItemId}, CAST(${vectorLiteral} AS vector), ${GEMINI_MODELS.EMBEDDING})
        ON CONFLICT ("knowledgeItemId") DO UPDATE
        SET "vector" = CAST(${vectorLiteral} AS vector), "model" = ${GEMINI_MODELS.EMBEDDING}
      `;
        }
        // --- Tags ---
        const existingTagCount = await prisma.tagOnItem.count({
            where: { itemId: knowledgeItemId, addedByAI: true },
        });
        if (existingTagCount > 0) {
            logger.info(`Reusing ${existingTagCount} existing AI tags for ${knowledgeItemId}`);
        }
        else {
            logger.info(`Extracting tags...`);
            const tagNames = await extractTags(content, summary);
            logger.info(`Got ${tagNames.length} tags: ${tagNames.join(', ')}`);
            for (const tagName of tagNames) {
                const normalized = normalizeTagName(tagName);
                if (!normalized)
                    continue;
                const tag = await prisma.tag.upsert({
                    where: { name: normalized },
                    create: { name: normalized },
                    update: {},
                });
                await prisma.tagOnItem.upsert({
                    where: {
                        itemId_tagId: {
                            itemId: knowledgeItemId,
                            tagId: tag.id,
                        },
                    },
                    create: {
                        itemId: knowledgeItemId,
                        tagId: tag.id,
                        addedByAI: true,
                    },
                    update: {},
                });
            }
        }
        await prisma.knowledgeItem.update({
            where: { id: knowledgeItemId },
            data: { status: 'COMPLETED' },
        });
        await invalidateWorkspaceItems(item.workspaceId);
        socketEmit.toWorkspace(item.workspaceId, 'knowledge:updated', {
            itemId: knowledgeItemId,
            status: 'COMPLETED',
        });
        logger.info(`Pipeline COMPLETED for: ${knowledgeItemId}`);
        return { status: 'completed' };
    }
    catch (error) {
        const message = error?.message || 'Processing failed';
        if (!isFinalAttempt) {
            logger.warn(`Pipeline attempt ${attempt + 1}/${maxAttempts + 1} failed for ${knowledgeItemId}, will retry: ${message}`);
            await recordFailure(knowledgeItemId, message, false);
            // Surfaced to the worker, which returns a non-2xx so QStash redelivers.
            throw error;
        }
        logger.error(`Pipeline FAILED permanently for ${knowledgeItemId}:`, error);
        await recordFailure(knowledgeItemId, message, true);
        if (workspaceId) {
            socketEmit.toWorkspace(workspaceId, 'knowledge:updated', {
                itemId: knowledgeItemId,
                status: 'FAILED',
                error: message,
            });
        }
        return { status: 'failed', error: message };
    }
}
function runInline(knowledgeItemId) {
    setImmediate(() => {
        // maxAttempts 0: nothing will redeliver this, so the first failure is terminal.
        processKnowledgeItem(knowledgeItemId, { attempt: 0, maxAttempts: 0 }).catch((err) => {
            logger.error(`Pipeline crashed for ${knowledgeItemId}:`, err);
        });
    });
}
/**
 * Hands item processing to the background queue.
 *
 * With QStash configured this returns as soon as the job is durably accepted and
 * the work happens in a separate, retried request driven by QStash. Without it,
 * the pipeline runs in this process as before.
 */
export async function enqueueContentProcessing(knowledgeItemId) {
    logger.info(`Enqueuing processing for item: ${knowledgeItemId}`);
    if (getQueueDriver() === 'qstash') {
        const url = jobUrl(JobType.PROCESS_KNOWLEDGE_ITEM);
        try {
            const res = await qstash.publishJSON({
                url,
                body: { knowledgeItemId },
                retries: PROCESS_ITEM_RETRIES,
                timeout: JOB_TIMEOUT,
            });
            logger.info(`Queued ${knowledgeItemId} on QStash (message ${res.messageId})`);
            return;
        }
        catch (error) {
            // Never drop the item just because the queue is unreachable.
            logger.error(`QStash publish failed for ${knowledgeItemId}, running inline instead:`, error);
        }
    }
    runInline(knowledgeItemId);
}
//# sourceMappingURL=queue.service.js.map