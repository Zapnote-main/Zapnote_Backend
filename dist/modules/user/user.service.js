import prisma from "../../config/db.js";
import { cache, CacheKeys, CACHE_TTL } from "../../config/redis.js";
import { logger } from '../../utils/logger.js';
import { ConflictError } from '../../utils/error.js';
function parseCachedData(cached) {
    if (typeof cached === 'string') {
        return JSON.parse(cached);
    }
    return cached;
}
export async function getUserById(userId) {
    const cacheKey = CacheKeys.userProfile(userId);
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            logger.debug(`Cache HIT: ${cacheKey}`);
            return parseCachedData(cached);
        }
        logger.debug(`Cache MISS: ${cacheKey}`);
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                photoURL: true,
                createdAt: true,
            },
        });
        if (user) {
            await cache.set(cacheKey, user, CACHE_TTL.USER_PROFILE);
        }
        return user;
    }
    catch (error) {
        logger.error('Error fetching user:', error);
        throw error;
    }
}
export async function updateUserProfile(userId, data) {
    try {
        //username is already taken 
        if (data.username) {
            const existing = await prisma.user.findFirst({
                where: {
                    username: data.username,
                    NOT: { id: userId },
                },
            });
            if (existing) {
                throw new ConflictError('Username already taken');
            }
        }
        const updated = await prisma.user.update({
            where: { id: userId },
            data,
            select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                photoURL: true,
                createdAt: true,
            },
        });
        await cache.del(CacheKeys.userProfile(userId));
        logger.info(`User profile updated: ${userId}`);
        return updated;
    }
    catch (error) {
        logger.error('Error updating user:', error);
        throw error;
    }
}
export async function getUserStats(userId) {
    try {
        const [workspaceStats, knowledgeCount, conversationCount] = await Promise.all([
            prisma.workspaceMember.groupBy({
                by: ['userId'],
                where: { userId },
                _count: true,
            }),
            prisma.knowledgeItem.count({
                where: { createdById: userId },
            }),
            prisma.conversation.count({
                where: { userId },
            }),
        ]);
        const ownedWorkspaces = await prisma.workspace.count({
            where: { ownerId: userId },
        });
        return {
            totalWorkspaces: workspaceStats[0]?._count || 0,
            ownedWorkspaces: ownedWorkspaces,
            totalKnowledgeItems: knowledgeCount,
            totalConversations: conversationCount,
        };
    }
    catch (error) {
        logger.error('Error fetching user stats:', error);
        throw error;
    }
}
export async function getUserWorkspaces(userId) {
    const cacheKey = CacheKeys.userWorkspaces(userId);
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            logger.debug(`Cache HIT: ${cacheKey}`);
            return parseCachedData(cached);
        }
        logger.debug(`Cache MISS: ${cacheKey}`);
        const workspaces = await prisma.workspaceMember.findMany({
            where: { userId },
            include: {
                workspace: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        createdAt: true,
                        updatedAt: true,
                        ownerId: true,
                        _count: {
                            select: {
                                members: true,
                                items: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                joinedAt: 'desc',
            },
        });
        const result = workspaces.map((wm) => {
            const { _count, ...workspace } = wm.workspace;
            return {
                ...workspace,
                role: wm.role,
                joinedAt: wm.joinedAt,
                memberCount: _count.members,
                itemCount: _count.items,
            };
        });
        await cache.set(cacheKey, result, CACHE_TTL.WORKSPACE_LIST);
        return result;
    }
    catch (error) {
        logger.error('Error fetching user workspaces:', error);
        throw error;
    }
}
export async function deleteUser(userId) {
    try {
        await prisma.user.delete({
            where: { id: userId },
        });
        await cache.del(CacheKeys.userProfile(userId));
        await cache.del(CacheKeys.userWorkspaces(userId));
        logger.info(`User deleted: ${userId}`);
    }
    catch (error) {
        logger.error('Error deleting user:', error);
        throw error;
    }
}
//# sourceMappingURL=user.service.js.map