import prisma from '../../config/db.js';
import { cache, CacheKeys, CACHE_TTL } from '../../config/redis.js';
import { generateEmbeddingCached } from '../../services/ai/embedding.service.js';
import { vectorSearch, hybridSearch } from '../../services/ai/vector.service.js';
import { logger } from '../../utils/logger.js';
function applySimilarityPolicy(results) {
    if (!results || results.length === 0)
        return [];
    const first = results[0];
    if (!first)
        return [];
    const top = first.similarity;
    if (top >= 0.6) {
        return [first];
    }
    if (top >= 0.5) {
        return results.filter(r => r.similarity >= 0.5).slice(0, 2);
    }
    return [];
}
export async function semanticSearch(query, workspaceId, limit = 20, filters) {
    const cacheKey = CacheKeys.searchResults(query, workspaceId);
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            logger.debug(`Search cache HIT: ${query}`);
            return typeof cached === 'string' ? JSON.parse(cached) : cached;
        }
        logger.debug(`Search cache MISS: ${query}`);
        const queryEmbedding = await generateEmbeddingCached(query);
        const rawResults = await vectorSearch(queryEmbedding, workspaceId, limit, filters);
        const itemIds = rawResults.map((r) => r.id);
        const tagsData = await prisma.tagOnItem.findMany({
            where: { itemId: { in: itemIds } },
            include: { tag: true },
        });
        const tagsByItem = tagsData.reduce((acc, t) => {
            const itemTags = (acc[t.itemId] ??= []);
            itemTags.push(t.tag.name);
            return acc;
        }, {});
        const results = rawResults.map((r) => ({
            id: r.id,
            title: r.title,
            summary: r.summary,
            sourceUrl: r.sourceUrl,
            contentType: r.contentType,
            similarity: parseFloat(r.similarity),
            tags: tagsByItem[r.id] || [],
            createdAt: r.createdAt,
        }));
        let filteredResults = results;
        if (filters?.tags && filters.tags.length > 0) {
            filteredResults = results.filter((r) => filters.tags.some((tag) => r.tags.includes(tag)));
        }
        // Apply similarity policy thresholds (>=0.6 => top1, 0.5-0.6 => up to top2, else none)
        const finalResults = applySimilarityPolicy(filteredResults);
        const response = {
            query,
            results: finalResults,
            totalResults: finalResults.length,
        };
        await cache.set(cacheKey, response, CACHE_TTL.SEARCH_RESULTS);
        logger.info(`Semantic search completed: ${filteredResults.length} results`);
        return response;
    }
    catch (error) {
        logger.error('Semantic search error:', error);
        throw error;
    }
}
export async function performHybridSearch(query, workspaceId, limit = 20) {
    try {
        const queryEmbedding = await generateEmbeddingCached(query);
        const rawResults = await hybridSearch(queryEmbedding, query, workspaceId, limit);
        const itemIds = rawResults.map((r) => r.id);
        const tagsData = await prisma.tagOnItem.findMany({
            where: { itemId: { in: itemIds } },
            include: { tag: true },
        });
        const tagsByItem = tagsData.reduce((acc, t) => {
            const itemTags = (acc[t.itemId] ??= []);
            itemTags.push(t.tag.name);
            return acc;
        }, {});
        const results = rawResults.map((r) => ({
            id: r.id,
            title: r.title,
            summary: r.summary,
            sourceUrl: r.sourceUrl,
            contentType: r.contentType,
            similarity: parseFloat(r.combined_score),
            tags: tagsByItem[r.id] || [],
            createdAt: r.createdAt,
        }));
        const finalResults = applySimilarityPolicy(results);
        logger.info(`Hybrid search completed: ${finalResults.length} results`);
        return {
            query,
            results: finalResults,
            totalResults: finalResults.length,
        };
    }
    catch (error) {
        logger.error('Hybrid search error:', error);
        throw error;
    }
}
//# sourceMappingURL=search.service.js.map