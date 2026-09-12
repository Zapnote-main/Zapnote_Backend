import './config/env.js';
import express from 'express';
import cors from 'cors';
import compression from 'compression';

import { initFirebase } from './config/firebase.js';
import { testRedisConnection } from './config/redis.js';
import { logQueueDriver } from './config/qstash.js';
import { corsOriginCheck, logCorsPolicy } from './config/cors.js';
import { errorHandler } from './middleware/error.middleware.js';
import { logger } from './utils/logger.js';
import prisma from './config/db.js';


import userRoutes from './modules/user/user.route.js';
import knowledgeRoutes from './modules/knowledge/knowledge.route.js';
import workspaceRoutes from './modules/workspace/workspace.route.js';
import chatRoutes from './modules/chat/chat.route.js';
import searchRoutes from './modules/search/search.route.js';
import whiteboardRoutes from './modules/whiteboard/whiteboard.routes.js';
import jobRoutes from './modules/jobs/jobs.route.js';

const app = express();

initFirebase();
testRedisConnection();
logQueueDriver();
logCorsPolicy();

app.use(compression());

app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  cors({
    origin: corsOriginCheck,
    credentials: true,
  })
);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// --- TEST SEED ROUTE (REMOVE IN PRODUCTION) ---
// app.post('/api/test/seed', async (req, res) => {
//   try {
//     const userId = '11111111-1111-4111-8111-111111111111';
//     const workspaceId = '22222222-2222-4222-8222-222222222222';

//     const existingUser = await prisma.user.findFirst({
//       where: {
//         OR: [
//           { email: 'test@example.com' },
//           { username: 'testuser' }
//         ]
//       }
//     });

//     if (existingUser && existingUser.id !== userId) {
//       console.log(`[TEST SEED] Deleting conflicting user ${existingUser.id}`);
//       await prisma.user.delete({ where: { id: existingUser.id } });
//     }

//     const user = await prisma.user.upsert({
//       where: { id: userId },
//       update: {},
//       create: {
//         id: userId,
//         email: 'test@example.com',
//         username: 'testuser',
//         displayName: 'Test User',
//       },
//     });

//     const workspace = await prisma.workspace.upsert({
//       where: { id: workspaceId },
//       update: {},
//       create: {
//         id: workspaceId,
//         name: 'Test Workspace',
//         ownerId: userId,
//       },
//     });

//     await prisma.workspaceMember.upsert({
//       where: {
//         userId_workspaceId: {
//           userId,
//           workspaceId,
//         },
//       },
//       update: { role: 'OWNER' },
//       create: {
//         userId,
//         workspaceId,
//         role: 'OWNER',
//       },
//     });

//     res.json({
//       success: true,
//       message: 'Test data seeded successfully',
//       data: { user, workspace },
//     });
//   } catch (error) {
//     console.error('Seeding error:', error);
//     res.status(500).json({ success: false, error: 'Failed to seed data' });
//   }
// });
// ----------------------------------------------


//API Routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/workspaces', workspaceRoutes);
app.use('/api/v1/workspaces/:workspaceId/chat', chatRoutes);
app.use('/api/v1/workspaces/:workspaceId/search', searchRoutes);
app.use('/api/v1/workspaces/:workspaceId/spaces', whiteboardRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);

// Background jobs delivered by QStash. Mounted on its own path because it is
// authenticated by the Upstash signature, not a Firebase token.
app.use('/api/v1/jobs', jobRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});


app.use(errorHandler);

export default app;