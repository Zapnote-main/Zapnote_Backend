import { cache, CacheKeys, CACHE_TTL } from '../config/redis.js';
import prisma from '../config/db.js';
import { ForbiddenError, NotFoundError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
export async function checkWorkspaceAccess(req, res, next) {
    try {
        const { workspaceId } = req.params;
        const userId = req.userId;
        if (!workspaceId || !userId) {
            throw new ForbiddenError('Missing workspace ID or user ID');
        }
        const cacheKey = CacheKeys.workspacePermissions(userId, workspaceId);
        const cachedRole = await cache.get(cacheKey);
        if (cachedRole) {
            logger.debug(`Permission cache HIT: ${cacheKey}`);
            req.workspaceRole = cachedRole;
            return next();
        }
        logger.debug(`Permission cache MISS: ${cacheKey}`);
        const member = await prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId,
                    workspaceId,
                },
            },
            select: {
                role: true,
            },
        });
        if (!member) {
            throw new ForbiddenError('Access denied to this workspace');
        }
        await cache.set(cacheKey, member.role, CACHE_TTL.WORKSPACE_PERMISSIONS);
        req.workspaceRole = member.role;
        next();
    }
    catch (error) {
        next(error);
    }
}
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.workspaceRole;
        if (!userRole || !allowedRoles.includes(userRole)) {
            throw new ForbiddenError(`This action requires one of the following roles: ${allowedRoles.join(', ')}`);
        }
        next();
    };
}
export async function requireWorkspaceOwner(req, res, next) {
    try {
        const { workspaceId } = req.params;
        const userId = req.userId;
        if (!workspaceId || !userId) {
            throw new ForbiddenError('Missing workspace ID or user ID');
        }
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        });
        if (!workspace) {
            throw new NotFoundError('Workspace not found');
        }
        if (workspace.ownerId !== userId) {
            throw new ForbiddenError('Only workspace owner can perform this action');
        }
        next();
    }
    catch (error) {
        next(error);
    }
}
//# sourceMappingURL=workspace.middleware.js.map