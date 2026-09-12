import { generateEmbedding as geminiEmbed } from './gemini.service.js';
import { cache, CacheKeys, CACHE_TTL, parseCached } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';


export async function generateEmbeddingCached(text: string): Promise<number[]> {
  const cacheKey = CacheKeys.embedding(text);

  try {
    // cache.get absorbs a Redis outage and reports it as a miss, so the
    // per-call try/catch this used to need now lives in one place.
    const cached = await cache.get<number[] | string>(cacheKey);
    if (cached) {
      logger.debug(`Embedding cache HIT`);
      return parseCached<number[]>(cached);
    }

    logger.debug(`Embedding cache MISS`);
    const embedding = await geminiEmbed(text.slice(0, 10000));

    await cache.set(cacheKey, embedding, CACHE_TTL.EMBEDDINGS);

    return embedding;
  } catch (error) {
    logger.error('Embedding generation error:', error);
    throw error;
  }
}
