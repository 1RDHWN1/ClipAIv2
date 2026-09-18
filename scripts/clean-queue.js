// scripts/clean-queue.js
import { videoQueue, redisConnection } from '../queues/videoQueue.js';

async function cleanQueue() {
  console.log('🧹 Menghubungkan ke Redis dan mengosongkan antrean job BullMQ...');
  
  try {
    // Obliterate removes all jobs in all states (waiting, active, delayed, failed, completed)
    await videoQueue.obliterate({ force: true });
    console.log('✅ Seluruh antrean job (waiting, active, failed) di Redis berhasil dikosongkan!');
  } catch (err) {
    console.error('❌ Gagal mengosongkan antrean:', err.message);
  } finally {
    await redisConnection.quit();
    process.exit(0);
  }
}

cleanQueue();
