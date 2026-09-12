import prisma from '../../config/db.js';
import { cache, CacheKeys, CACHE_TTL } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/error.js';
import { Role } from '@prisma/client';
import { WorkspaceMemberWithUser } from './workspace.types.js';


function parseCachedData<T>(cached: any): T {
  if (typeof cached === 'string') {
    return JSON.parse(cached);
  }
  return cached as T;
}

export async function createWorkspace(
  userId: string,
  data: {
    name: string;
    description?: string;
  }
) {
  try {
    const workspace = await prisma.workspace.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
      },
    });

    await cache.del(CacheKeys.userWorkspaces(userId));

    logger.info(`Workspace created: ${workspace.id} by user: ${userId}`);

    return {
      ...workspace,
      //@ts-ignore
      role: workspace.members[0].role,
    };
  } catch (error) {
    logger.error('Error creating workspace:', error);
    throw error;
  }
}

export async function getWorkspaceById(workspaceId: string, userId: string) {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: {
          select: {
            members: true,
            items: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }

    if (workspace.members.length === 0) {
      throw new ForbiddenError('Access denied to this workspace');
    }

    return {
      ...workspace,
      //@ts-ignore
      role: workspace.members[0].role,
      memberCount: workspace._count.members,
      itemCount: workspace._count.items,
    };
  } catch (error) {
    logger.error('Error fetching workspace:', error);
    throw error;
  }
}

export async function updateWorkspace(
  workspaceId: string,
  data: {
    name?: string;
    description?: string;
  }
) {
  try {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description ?? null;

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: updateData,
    });

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    });

    await Promise.all(
      members.map((m) => cache.del(CacheKeys.userWorkspaces(m.userId)))
    );

    logger.info(`Workspace updated: ${workspaceId}`);
    return updated;
  } catch (error) {
    logger.error('Error updating workspace:', error);
    throw error;
  }
}

export async function deleteWorkspace(workspaceId: string) {
  try {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    });

    await prisma.workspace.delete({
      where: { id: workspaceId },
    });

    await Promise.all([
      ...members.map((m) => cache.del(CacheKeys.userWorkspaces(m.userId))),
      cache.del(CacheKeys.workspace(workspaceId)),
      cache.del(CacheKeys.workspaceMembers(workspaceId)),
    ]);

    logger.info(`Workspace deleted: ${workspaceId}`);
  } catch (error) {
    logger.error('Error deleting workspace:', error);
    throw error;
  }
}

export async function getWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMemberWithUser[]> {
  const cacheKey = CacheKeys.workspaceMembers(workspaceId);

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`Cache HIT: ${cacheKey}`);
      return parseCachedData<WorkspaceMemberWithUser[]>(cached);
    }

    logger.debug(`Cache MISS: ${cacheKey}`);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            photoURL: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    await cache.set(cacheKey, members, CACHE_TTL.WORKSPACE_LIST);

    return members;
  } catch (error) {
    logger.error('Error fetching workspace members:', error);
    throw error;
  }
}

export async function addWorkspaceMember(
  workspaceId: string,
  email: string,
  role: Role
) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundError('User with this email not found');
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId,
        },
      },
    });

    if (existing) {
      throw new ConflictError('User is already a member of this workspace');
    }

    const member = await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            photoURL: true,
          },
        },
      },
    });

    await Promise.all([
      cache.del(CacheKeys.workspaceMembers(workspaceId)),
      cache.del(CacheKeys.userWorkspaces(user.id)),
    ]);

    logger.info(`Member added to workspace: ${workspaceId}, user: ${user.id}`);
    return member;
  } catch (error) {
    logger.error('Error adding workspace member:', error);
    throw error;
  }
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  newRole: Role
) {
  try {
    const updated = await prisma.workspaceMember.update({
      where: {
        id: memberId,
        workspaceId, 
      },
      data: { role: newRole },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            photoURL: true,
          },
        },
      },
    });

    await Promise.all([
      cache.del(CacheKeys.workspaceMembers(workspaceId)),
      cache.del(CacheKeys.workspacePermissions(updated.userId, workspaceId)),
    ]);

    logger.info(`Member role updated: ${memberId} to ${newRole}`);
    return updated;
  } catch (error) {
    logger.error('Error updating member role:', error);
    throw error;
  }
}

export async function removeMember(workspaceId: string, memberId: string) {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { userId: true, workspaceId: true },
    });

    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundError('Member not found in this workspace');
    }

    await prisma.workspaceMember.delete({
      where: { id: memberId },
    });

    await Promise.all([
      cache.del(CacheKeys.workspaceMembers(workspaceId)),
      cache.del(CacheKeys.userWorkspaces(member.userId)),
      cache.del(CacheKeys.workspacePermissions(member.userId, workspaceId)),
    ]);

    logger.info(`Member removed from workspace: ${workspaceId}, member: ${memberId}`);
  } catch (error) {
    logger.error('Error removing member:', error);
    throw error;
  }
}

export async function leaveWorkspace(workspaceId: string, userId: string) {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (workspace?.ownerId === userId) {
      throw new ForbiddenError(
        'Workspace owner cannot leave. Transfer ownership or delete workspace first.'
      );
    }

    await prisma.workspaceMember.delete({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
    });

    await Promise.all([
      cache.del(CacheKeys.workspaceMembers(workspaceId)),
      cache.del(CacheKeys.userWorkspaces(userId)),
      cache.del(CacheKeys.workspacePermissions(userId, workspaceId)),
    ]);

    logger.info(`User left workspace: ${workspaceId}, user: ${userId}`);
  } catch (error) {
    logger.error('Error leaving workspace:', error);
    throw error;
  }
}