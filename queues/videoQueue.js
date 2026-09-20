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
    removeOnComplete: { count: 200, age: 7 * 86400 }, // simpan hingga 200 job terakhir / 7 hari
    removeOnFail: { count: 100, age: 7 * 86400 },    // simpan hingga 100 job gagal / 7 hari

    // ---------------------------------------------------------------
    // No automatic re-run after a restart.
    // ---------------------------------------------------------------
    // `npm start` used to silently resume whatever the previous session had
    // left in Redis: a job that was mid-render when the user pressed Ctrl+C
    // sat in the queue and got picked up by the next worker. From the user's
    // side the app "continued the old job by itself" instead of starting
    // clean.
    //
    // They want an explicit model: Ctrl+C = everything stops, and work resumes
    // ONLY when they hand in a new link. So these jobs are queued, not
    // resurrected. `npm run stop` / the UI's "Stop Semua" clears the backlog.
    // ---------------------------------------------------------------
  },
});

/**
 * Cancel everything: waiting, delayed, and active jobs.
 *
 * `queue.drain()` alone is not enough — it empties WAITING jobs but leaves
 * ACTIVE ones running, and BullMQ has no `queue.stop()` for a Queue instance
 * (only a Worker has). Active jobs are signalled through their own worker.
 *
 * @returns {Promise<{removed:number, activeSignalled:number}>}
 */
export async function clearQueue() {
  // A running job cannot be stopped by removing its queue entry — the worker
  // holds it in memory and will finish (BullMQ only reads the queue between
  // jobs). `moveToFailed` is also unreliable while the job is locked: moving it
  // schedules the job's retry into `delayed`, so the cancellation appeared to
  // work and then the job came back.
  //
  // The reliable order is therefore:
  //   1. drain the wait list (nothing new gets picked up);
  //   2. force-remove every job hash, INCLUDING the active one and any delayed
  //      retry it just produced;
  //   3. sweep leftovers.
  // The worker stops at its next queue interaction because its job no longer
  // exists, and the active render is torn down by the worker's own SIGTERM.
  await videoQueue.drain(true);

  const active = await videoQueue.getActive();
  let removed = 0;

  // Collect the live job ids first: `remove()` needs the Job instance, and the
  // delayed list can grow while we iterate it.
  const toRemove = new Set();
  for (const state of ['active', 'waiting', 'delayed', 'failed', 'paused']) {
    try {
      const jobs = await videoQueue.getJobs([state], 0, 1000);
      for (const job of jobs) if (job?.id) toRemove.add(job.id);
    } catch (_) {}
  }

  for (const id of toRemove) {
    try {
      const job = await videoQueue.getJob(id);
      if (job) {
        await job.remove();
        removed += 1;
      }
    } catch (_) {
      // A job mid-transition can refuse removal; the zombie sweep below is the
      // backstop that clears its hash anyway.
    }
  }

  // Backstop: delete any job hash that no longer appears in a live state, which
  // covers jobs whose removal raced with a state change.
  await removeZombieJobs();

  return { removed, activeSignalled: active.length };
}

/**
 * Delete job hashes that belong to no live queue.
 *
 * BullMQ normally cleans these up, but a hard kill (SIGKILL during a render)
 * leaves the hash + lock orphaned. They are harmless for correctness yet make
 * `npm start` look like it "resumed" an old job, and they hold a lock anyone
 * debugging would have to reason about. Removing them keeps boot clean.
 *
 * @returns {Promise<number>} how many job hashes were removed
 */
async function removeZombieJobs() {
  const client = await videoQueue.client;
  const PREFIX = videoQueue.opts.prefix || 'bull';
  const NAME = videoQueue.name;

  // Every job id that still belongs to a state list.
  const liveStates = ['wait', 'active', 'delayed', 'failed', 'completed', 'paused'];
  const liveIds = new Set();
  for (const state of liveStates) {
    try {
      const ids = await client.lrange(`${PREFIX}:${NAME}:${state}`, 0, -1);
      for (const id of ids) liveIds.add(id);
    } catch (_) {}
  }

  let removed = 0;
  // Job hashes look like `bull:video-processing:<uuid>` (no further colon).
  const keys = await client.keys(`${PREFIX}:${NAME}:*`);
  for (const key of keys) {
    const tail = key.slice(`${PREFIX}:${NAME}:`.length);
    // Skip internal keys: they contain a ':' (e.g. `<id>:lock`) or are
    // named meta/events/id/marker, or are state lists themselves.
    if (!tail || tail.includes(':') || liveStates.includes(tail)) continue;
    if (['meta', 'events', 'id', 'marker', 'repeat', 'prioritized'].includes(tail)) continue;

    // It is a job hash only if it holds a `name` field and is not live.
    const isJob = await client.type(key);
    if (isJob !== 'hash') continue;
    if (liveIds.has(tail)) continue;

    try {
      await client.del(key);
      await client.del(`${key}:lock`);
      await client.del(`${key}:logs`);
      removed += 1;
    } catch (_) {}
  }

  return removed;
}

/** Counts per state, for the status endpoint and the stop script. */
export async function getQueueCounts() {
  const counts = await videoQueue.getJobCounts(
    'waiting', 'active', 'delayed', 'failed', 'completed', 'paused'
  );
  // BullMQ reports 'wait' internally; normalise to the name callers expect.
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
    paused: counts.paused ?? 0,
  };
}
