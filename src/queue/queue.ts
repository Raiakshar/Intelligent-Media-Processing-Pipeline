import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

// BullMQ requires this option on the ioredis connection.
export const redisConnection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: null,
    });

export const IMAGE_ANALYSIS_QUEUE = 'image-analysis';

export interface ImageAnalysisJobData {
  imageId: string;
}

export const imageAnalysisQueue = new Queue<ImageAnalysisJobData>(IMAGE_ANALYSIS_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: {
      age: 3600, // keep completed job records for 1h then GC (Redis, not Postgres -- DB row persists)
      count: 1000,
    },
    removeOnFail: {
      age: 24 * 3600, // keep failed jobs around longer for debugging
    },
  },
});
