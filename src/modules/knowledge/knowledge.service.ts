import prisma from '../../config/db.js';
import { cache, CacheKeys, CACHE_TTL, parseCached } from '../../config/redis.js';
import { socketEmit } from '../../config/socket.js';
import { logger } from '../../utils/logger.js';
import { NotFoundError } from '../../utils/error.js';
import { ContentType, ProcessingStatus } from '@prisma/client';
import { enqueueContentProcessing } from '../../services/queue/queue.service.js';

/**
 * Fields the list endpoint returns. Deliberately excludes `scrapedContent`, which
 * holds the entire scraped article and was previously sent for every row even
 * though nothing in the client reads it.
 */
const LIST_ITEM_SELECT = {
  id: true,
  sourceUrl: true,
  userIntent: true,
  summary: true,
  contentType: true,
  status: true,
  errorMessage: true,
  metadata: true,
  workspaceId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  tags: {
    select: {
      addedByAI: true,
      tag: { select: { id: true, name: true } },
    },
  },
} as const;

export type KnowledgeItemsPage = {
  items: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function formatTags(tags: any[]) {
  return (tags || []).map((t: any) => ({
    id: t.tag.id,
    name: t.tag.name,
    addedByAI: t.addedByAI,
  }));
}


function maskUntilCompleted(item: any) {
  if (item?.status === 'COMPLETED') return item;

  return {
    ...item,
    summary: null,
    scrapedContent: null,
    metadata: null,
    tags: [],
    embedding: null,
  };
}


/** Drops every cached list variant for this workspace in one command. */
async function invalidateItemLists(workspaceId: string) {
  await cache.bump(CacheKeys.workspaceItemsVersion(workspaceId));
}


export async function createKnowledgeItem(
  workspaceId: string,
  userId: string,
  data: {
    sourceUrl: string;
    userIntent?: string;
  }
) {
  try {
    const item = await prisma.knowledgeItem.create({
      data: {
        sourceUrl: data.sourceUrl,
        ...(data.userIntent !== undefined ? { userIntent: data.userIntent } : {}),
        workspaceId,
        createdById: userId,
        status: 'PENDING',
      },
    });

    await invalidateItemLists(workspaceId);

    await enqueueContentProcessing(item.id);

    socketEmit.toWorkspace(workspaceId, 'knowledge:created', {
      item,
      createdBy: userId,
    });

    logger.info(`Knowledge item created and queued: ${item.id}`);
    return item;
  } catch (error) {
    logger.error('Error creating knowledge item:', error);
    throw error;
  }
}


export async function getKnowledgeItems(
  workspaceId: string,
  filters: {
    page: number;
    limit: number;
    type?: ContentType;
    status?: ProcessingStatus;
  }
): Promise<KnowledgeItemsPage> {
  try {
    const { page, limit, type, status } = filters;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId,
      ...(type && { contentType: type }),
      ...(status && { status }),
    };

    // One cache entry per filter combination, all tied to the workspace's current
    // invalidation version so a single bump drops every variant.
    const version = await cache.version(CacheKeys.workspaceItemsVersion(workspaceId));
    const cacheKey = CacheKeys.workspaceItems(
      workspaceId,
      version,
      `${page}:${limit}:${type ?? ''}:${status ?? ''}`
    );

    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`Items cache HIT: ${cacheKey}`);
      return parseCached<KnowledgeItemsPage>(cached);
    }

    logger.debug(`Items cache MISS: ${cacheKey}`);

    const [items, total] = await Promise.all([
      prisma.knowledgeItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: LIST_ITEM_SELECT,
      }),
      prisma.knowledgeItem.count({ where }),
    ]);


    const formattedItems = items.map((item: any) => {
      const formatted = {
        ...item,
        tags: formatTags(item.tags),
      };

      return maskUntilCompleted(formatted);
    });

    const result: KnowledgeItemsPage = {
      items: formattedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    await cache.set(cacheKey, result, CACHE_TTL.WORKSPACE_ITEMS);

    return result;
  } catch (error) {
    logger.error('Error fetching knowledge items:', error);
    throw error;
  }
}


export async function getKnowledgeItemById(itemId: string, workspaceId: string) {
  try {
    const item = await prisma.knowledgeItem.findFirst({
      where: {
        id: itemId,
        workspaceId,
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        embedding: true,
      },
    });

    if (!item) {
      throw new NotFoundError('Knowledge item not found');
    }

    const formatted = {
      ...item,
      tags: formatTags(item.tags),
    };

    return maskUntilCompleted(formatted);
  } catch (error) {
    logger.error('Error fetching knowledge item:', error);
    throw error;
  }
}


export async function updateKnowledgeItem(
  itemId: string,
  workspaceId: string,
  data: {
    userIntent?: string;
  }
) {
  try {
    const existing = await prisma.knowledgeItem.findFirst({
      where: {
        id: itemId,
        workspaceId,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError('Knowledge item not found');
    }

    const updated = await prisma.knowledgeItem.update({
      where: { id: existing.id },
      data,
    });

    await invalidateItemLists(workspaceId);

    logger.info(`Knowledge item updated: ${itemId}`);
    return updated;
  } catch (error) {
    logger.error('Error updating knowledge item:', error);
    throw error;
  }
}


export async function deleteKnowledgeItem(itemId: string, workspaceId: string) {
  try {
    const existing = await prisma.knowledgeItem.findFirst({
      where: {
        id: itemId,
        workspaceId,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError('Knowledge item not found');
    }

    await prisma.knowledgeItem.delete({
      where: { id: existing.id },
    });

    await invalidateItemLists(workspaceId);

    socketEmit.toWorkspace(workspaceId, 'knowledge:deleted', {
      itemId,
    });

    logger.info(`Knowledge item deleted: ${itemId}`);
  } catch (error) {
    logger.error('Error deleting knowledge item:', error);
    throw error;
  }
}
