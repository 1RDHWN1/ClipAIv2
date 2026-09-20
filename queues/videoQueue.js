// queues/videoQueue.js
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import 'dotenv/config';

let lastErrorLogTime = 0;
const ERROR_LOG_THROTTLE_MS = 5000;

export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    // Exponential backoff capped at 5s to prevent reconnect storm
    const delay = Math.min(Math.pow(2, Math.min(times, 6)) * 100, 5000);
    return delay;
  },
});

redisConnection.on('connect', () => {
  lastErrorLogTime = 0;
  console.log('✅ Redis connected');
});

redisConnection.on('error', (err) => {
  const now = Date.now();
  if (now - lastErrorLogTime > ERROR_LOG_THROTTLE_MS) {
    console.error(`❌ Redis error: ${err.message} (retrying with backoff...)`);
    lastErrorLogTime = now;
  }
});

export const videoQueue = new Queue('video-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 }, // hapus job setelah 1 jam
    removeOnFail: { age: 86400 },    // hapus job gagal setelah 1 hari
  },
});
