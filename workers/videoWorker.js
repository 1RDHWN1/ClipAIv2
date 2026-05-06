// workers/videoWorker.js
import { Worker } from 'bullmq';
import { redisConnection } from '../queues/videoQueue.js';
import { downloadVideo, cleanupFiles } from '../utils/downloader.js';
import { transcribeAudio } from '../utils/transcriber.js';
import { analyzeTranscript } from '../utils/analyzer.js';
import { processClips } from '../utils/clipper.js';
import 'dotenv/config';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);

console.log('🚀 Video Worker starting...');

const worker = new Worker(
  'video-processing',
  async (job) => {
    const { url, aspectRatio, clipCount, jobId } = job.data;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎬 Processing job: ${jobId}`);
    console.log(`   URL: ${url}`);
    console.log(`   Aspect Ratio: ${aspectRatio}`);
    console.log(`   Clip Count: ${clipCount}`);
    console.log(`${'='.repeat(50)}`);

    let videoPath = null;
    let audioPath = null;

    try {
      // STEP 1: Download video
      await job.updateProgress({ step: 1, message: 'Mendownload video...', percent: 5 });
      const downloaded = await downloadVideo(url, jobId);
      videoPath = downloaded.videoPath;
      audioPath = downloaded.audioPath;

      console.log(`\n📹 Video: ${downloaded.title} (${downloaded.duration}s)`);

      await job.updateProgress({
        step: 1,
        message: `Video "${downloaded.title}" berhasil didownload`,
        percent: 25,
        videoTitle: downloaded.title,
        videoDuration: downloaded.duration,
      });

      // STEP 2: Transkripsi
      await job.updateProgress({ step: 2, message: 'Mentranskripsi audio...', percent: 30 });
      const { text, segments, language, speakerTurns = [] } = await transcribeAudio(audioPath, {
        onStatus: async ({ message, percent }) => {
          await job.updateProgress({
            step: 2,
            message,
            percent: percent || 30,
          });
        },
      });

      if (!text || text.trim().length < 10) {
        throw new Error('Transkripsi gagal atau video tidak memiliki dialog yang cukup.');
      }

      await job.updateProgress({
        step: 2,
        message: `Transkripsi selesai (${language.toUpperCase()}, ${segments.length} segment)`,
        percent: 55,
      });

      // STEP 3: AI Analisis
      await job.updateProgress({ step: 3, message: 'AI sedang menganalisis momen terbaik...', percent: 60 });
      const aiClips = await analyzeTranscript(text, segments, downloaded.duration, clipCount);

      if (aiClips.length === 0) {
        throw new Error('AI tidak menemukan segmen yang cocok. Coba video yang lebih panjang.');
      }

      await job.updateProgress({
        step: 3,
        message: `AI menemukan ${aiClips.length} momen terbaik`,
        percent: 70,
        clips: aiClips.map((c) => ({ title: c.title, score: c.score, duration: Math.round(c.end - c.start) })),
      });

      // STEP 4: Proses klip
      await job.updateProgress({ step: 4, message: 'Memotong dan memproses video...', percent: 75 });
      const processedClips = await processClips(videoPath, aiClips, jobId, aspectRatio, {
        speakerTurns,
      });

      await job.updateProgress({
        step: 4,
        message: `${processedClips.length} clip berhasil dibuat!`,
        percent: 95,
      });

      // STEP 5: Cleanup file sumber
      cleanupFiles(videoPath, audioPath);
      console.log('🧹 Temporary files cleaned up');

      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      const finalClips = processedClips.map((c) => ({
        index: c.clipIndex,
        title: c.title,
        reason: c.reason,
        score: c.score,
        duration: c.duration,
        fileSizeMB: c.fileSizeMB,
        downloadUrl: `${BASE_URL}/outputs/${c.filename}`,
        filename: c.filename,
      }));

      console.log(`\n✅ Job ${jobId} SELESAI! ${finalClips.length} clips generated.`);

      return {
        success: true,
        jobId,
        videoTitle: downloaded.title,
        videoDuration: downloaded.duration,
        language,
        clips: finalClips,
      };
    } catch (err) {
      // Cleanup jika error
      if (videoPath) cleanupFiles(videoPath);
      if (audioPath) cleanupFiles(audioPath);
      console.error(`❌ Job ${jobId} GAGAL:`, err.message);
      throw err;
    }
  },
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY,
  }
);

worker.on('completed', (job, result) => {
  console.log(`\n🎉 Job ${job.id} completed with ${result.clips?.length} clips`);
});

worker.on('failed', (job, err) => {
  console.error(`\n💥 Job ${job?.id} failed: ${err.message}`);
});

worker.on('progress', (job, progress) => {
  console.log(`📊 Job ${job.id} progress: ${progress.percent}% - ${progress.message}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  console.log('Worker stopped gracefully');
});

process.on('SIGINT', async () => {
  await worker.close();
  console.log('Worker stopped');
  process.exit(0);
});
