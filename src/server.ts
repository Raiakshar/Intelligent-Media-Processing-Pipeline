import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server started', { port: config.port, env: config.nodeEnv });
  logger.info('reminder: run `npm run dev:worker` in a separate process to actually process queued jobs');
});

process.on('SIGTERM', () => {
  logger.info('server shutting down (SIGTERM)');
  server.close(() => process.exit(0));
});
