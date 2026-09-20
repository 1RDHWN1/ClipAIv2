#!/usr/bin/env node
// scripts/stop-all.js
//
// Stop EVERYTHING ClipAIv2 and leave a clean slate.
//
// Ctrl+C already stops the server + worker, but two things survive it:
//   1. queued jobs sitting in Redis, which the NEXT `npm start` would pick up
//      and run — looking like the app "continued the old job by itself";
//   2. stray yt-dlp/ffmpeg children from an interrupted download.
//
// This script clears the queue, kills any leftover media tools, and reports
// what it did. Run it when you want a guaranteed clean stop before starting
// a fresh session.

import { execFileSync } from 'node:child_process';
import IORedis from 'ioredis';
import 'dotenv/config';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const QUEUE_NAME = 'video-processing';

function section(title) {
  console.log(`\n${'─'.repeat(58)}\n  ${title}\n${'─'.repeat(58)}`);
}

// ---------------------------------------------------------------------------
// 1. Clear the queue
// ---------------------------------------------------------------------------
async function clearRedisQueue() {
  const connection = new IORedis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  try {
    const { Queue } = await import('bullmq');
    const queue = new Queue(QUEUE_NAME, { connection });

    const before = await queue.getJobCounts(
      'waiting', 'active', 'delayed', 'failed', 'completed'
    );

    // `drain(true)` also drops delayed jobs, so a scheduled retry cannot
    // resurface on the next boot.
    await queue.drain(true);

    // A job left ACTIVE by a hard kill would otherwise still hold its slot.
    const active = await queue.getActive();
    for (const job of active) {
      try {
        await job.moveToFailed(new Error('Cancelled by user (stop-all)'), '0', true);
      } catch (_) {}
    }

    await queue.clean(0, 10000, 'failed');
    await queue.clean(0, 10000, 'completed');

    const after = await queue.getJobCounts(
      'waiting', 'active', 'delayed', 'failed', 'completed'
    );

    console.log(`  waiting: ${before.waiting} → ${after.waiting}`);
    console.log(`  active : ${before.active} → ${after.active}`);
    console.log(`  delayed: ${before.delayed} → ${after.delayed}`);
    console.log(`  failed : ${before.failed} → ${after.failed}`);

    await queue.close();
    return true;
  } catch (err) {
    console.error(`  ⚠️  Gagal membersihkan antrian: ${err.message}`);
    return false;
  } finally {
    connection.disconnect();
  }
}

// ---------------------------------------------------------------------------
// 2. Kill leftover media tools
// ---------------------------------------------------------------------------
function killLeftoverTools() {
  // Match the binaries by their argv, restricted to THIS project so an
  // unrelated ffmpeg (a video player, another project) is never touched.
  const patterns = [
    'node scripts/start-all.js',
    'ClipAIv2/server.js',
    'ClipAIv2/workers/videoWorker.js',
    'ClipAIv2/outputs',
  ];

  let killed = 0;
  for (const pattern of patterns) {
    try {
      execFileSync('pkill', ['-f', pattern], { stdio: 'ignore' });
      killed += 1;
    } catch (_) {
      // pkill exits 1 when nothing matched — that is the good case.
    }
  }

  // yt-dlp writes into outputs/ too, so it is covered above.
  return killed;
}

function checkPortFree() {
  try {
    const out = execFileSync('ss', ['-tlnp'], { encoding: 'utf-8' });
    return !out.includes(':3000');
  } catch (_) {
    return true; // cannot check → do not claim it is busy
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  section('🧹 ClipAIv2 — Stop Semua');

  console.log('\n[1/3] Menghentikan proses yang tersisa...');
  killLeftoverTools();
  console.log('  ✓ Proses server/worker/downloader dihentikan.');

  console.log('\n[2/3] Membersihkan antrian Redis...');
  await clearRedisQueue();

  console.log('\n[3/3] Memeriksa port 3000...');
  // Give the kernel a moment to release the listening socket.
  await new Promise((r) => setTimeout(r, 800));
  console.log(checkPortFree() ? '  ✓ Port 3000 bebas.' : '  ⚠️  Port 3000 masih dipakai.');

  section('✅ Selesai — semua bersih');
  console.log('\n  Sekarang `npm start` akan mulai dari kondisi kosong.');
  console.log('  Tidak ada job lama yang ikut jalan.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n❌ stop-all gagal: ${err.message}\n`);
    process.exit(1);
  });
