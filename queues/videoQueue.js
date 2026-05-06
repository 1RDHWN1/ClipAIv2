// queues/videoQueue.js
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import 'dotenv/config';

export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // required by BullMQ
});

redisConnection.on('connect', () => console.log('✅ Redis connected'));
redisConnection.on('error', (err) => console.error('❌ Redis error:', err.message));

export const videoQueue = new Queue('video-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 }, // hapus job setelah 1 jam
    removeOnFail: { age: 86400 },    // hapus job gagal setelah 1 hari
  },
});
