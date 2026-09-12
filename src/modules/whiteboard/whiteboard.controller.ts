import { Request, Response, NextFunction } from 'express';
import * as whiteboardService from './whiteboard.service.js';
import { successResponse } from '../../utils/response.js';
import { socketEmit } from '../../config/socket.js';


export async function createSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId } = req.params;
    const { name } = req.body;

    const space = await whiteboardService.createSpace(workspaceId!, name);

    socketEmit.toWorkspace(workspaceId!, 'space:created', space);

    successResponse(res, space, 'Space created successfully', 201);
  } catch (error) {
    next(error);
  }
}


export async function getSpaces(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId } = req.params;
    const spaces = await whiteboardService.getWorkspaceSpaces(workspaceId!);

    successResponse(res, spaces, 'Spaces fetched successfully');
  } catch (error) {
    next(error);
  }
}


export async function getSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId } = req.params;
    const space = await whiteboardService.getSpaceWithElements(spaceId!, workspaceId!);

    successResponse(res, space, 'Space fetched successfully');
  } catch (error) {
    next(error);
  }
}


export async function createElement(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId } = req.params;
    const { type, content } = req.body;

    const element = await whiteboardService.createElement(spaceId!, type, content);

    socketEmit.toSpace(spaceId!, 'element:created', { spaceId, element });

    successResponse(res, element, 'Element created successfully', 201);
  } catch (error) {
    next(error);
  }
}


export async function updateElement(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId, elementId } = req.params;
    const { content } = req.body;

    const element = await whiteboardService.updateElement(elementId!, spaceId!, content);

    socketEmit.toSpace(spaceId!, 'element:updated', { spaceId, element });

    successResponse(res, element, 'Element updated successfully');
  } catch (error) {
    next(error);
  }
}


export async function deleteElement(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId, elementId } = req.params;

    await whiteboardService.deleteElement(elementId!, spaceId!);

    socketEmit.toSpace(spaceId!, 'element:deleted', { spaceId, elementId });

    successResponse(res, null, 'Element deleted successfully');
  } catch (error) {
    next(error);
  }
}


export async function moveElement(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId, elementId } = req.params;
    const { content } = req.body;

    const element = await whiteboardService.moveElement(elementId!, spaceId!, content);

    socketEmit.toSpace(spaceId!, 'element:moved', { spaceId, element });

    successResponse(res, element, 'Element moved successfully');
  } catch (error) {
    next(error);
  }
}


export async function deleteSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { workspaceId, spaceId } = req.params;

    await whiteboardService.deleteSpace(spaceId!, workspaceId!);

    socketEmit.toWorkspace(workspaceId!, 'space:deleted', { spaceId });

    successResponse(res, null, 'Space deleted successfully');
  } catch (error) {
    next(error);
  }
}