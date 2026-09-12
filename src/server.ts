import './config/env.js';
import app from './app.js';
import { logger } from './utils/logger.js';
import prisma from './config/db.js';
import { execSync } from 'child_process';
import http from 'http';
import { initializeSocketIO, io } from './config/socket.js';

const PORT = process.env.PORT || 10000;

async function startServer() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    if (process.env.NODE_ENV === 'production') {
      try {
        logger.info('Running database migrations...');
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        logger.info('Migrations completed');
      } catch (error) {
        logger.warn('Migration warning:', error);
      }
    }

    // Socket.IO needs to share the HTTP server, so create it explicitly
    // instead of letting app.listen() make one we cannot reach.
    const httpServer = http.createServer(app);
    initializeSocketIO(httpServer);

    const server = httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      io?.close();
      server.close(async () => {
        logger.info('HTTP server closed');
        await prisma.$disconnect();
        logger.info('Database disconnected');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');
      io?.close();
      server.close(async () => {
        logger.info('HTTP server closed');
        await prisma.$disconnect();
        logger.info('Database disconnected');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();