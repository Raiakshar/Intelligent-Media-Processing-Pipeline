import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import './queue/worker'; // Start BullMQ worker in process so queued images analyze immediately

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server started', { port: config.port, env: config.nodeEnv });
});

process.on('SIGTERM', () => {
  logger.info('server shutting down (SIGTERM)');
  server.close(() => process.exit(0));
});
