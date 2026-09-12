import { ContentType, ProcessingStatus } from '@prisma/client';
export type KnowledgeItemsPage = {
    items: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};
export declare function createKnowledgeItem(workspaceId: string, userId: string, data: {
    sourceUrl: string;
    userIntent?: string;
}): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    workspaceId: string;
    createdById: string;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    sourceUrl: string;
    userIntent: string | null;
    summary: string | null;
    scrapedContent: string | null;
    contentType: import("@prisma/client").$Enums.ContentType;
    status: import("@prisma/client").$Enums.ProcessingStatus;
    errorMessage: string | null;
}>;
export declare function getKnowledgeItems(workspaceId: string, filters: {
    page: number;
    limit: number;
    type?: ContentType;
    status?: ProcessingStatus;
}): Promise<KnowledgeItemsPage>;
export declare function getKnowledgeItemById(itemId: string, workspaceId: string): Promise<any>;
export declare function updateKnowledgeItem(itemId: string, workspaceId: string, data: {
    userIntent?: string;
}): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    workspaceId: string;
    createdById: string;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    sourceUrl: string;
    userIntent: string | null;
    summary: string | null;
    scrapedContent: string | null;
    contentType: import("@prisma/client").$Enums.ContentType;
    status: import("@prisma/client").$Enums.ProcessingStatus;
    errorMessage: string | null;
}>;
export declare function deleteKnowledgeItem(itemId: string, workspaceId: string): Promise<void>;
//# sourceMappingURL=knowledge.service.d.ts.map