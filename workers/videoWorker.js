// workers/videoWorker.js
import fs from 'fs';
import { Worker } from 'bullmq';
import { redisConnection } from '../queues/videoQueue.js';
import { downloadVideo, downloadAudioAndInfo, cleanupFiles } from '../utils/downloader.js';
import { transcribeAudio, detectLanguageFromText, normalizeLanguageCode } from '../utils/transcriber.js';
import { parseGeminiTranscript } from '../utils/geminiTranscriptParser.js';
import { fetchGeminiApiTranscript } from '../utils/geminiVideoProvider.js';
import { extractTranscriptViaBrowser } from '../utils/youtubeAutomation.js';
import { analyzeTranscript } from '../utils/analyzer.js';
import { processClips } from '../utils/clipper.js';
import { detectAudioPeaks, annotateSentencesWithAudioPeaks } from '../utils/audioPeakDetector.js';
import 'dotenv/config';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);

console.log('🚀 Video Worker starting...');

const worker = new Worker(
  'video-processing',
  async (job) => {
    const { url, aspectRatio, clipCount = 3, transcriptText, subtitleConfig, layoutMode = 'standard' } = job.data;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎬 Processing job: ${jobId}`);
    console.log(`   URL: ${url}`);
    console.log(`   Aspect Ratio: ${aspectRatio}`);
    console.log(`   Clip Count: ${clipCount}`);
    if (transcriptText) {
      console.log(`   Custom Transcript: ${transcriptText.length} characters`);
    }
    if (subtitleConfig?.enabled) {
      console.log(`   Auto Subtitles: ENABLED (Preset: ${subtitleConfig.preset || 'hormozi'})`);
    } else {
      console.log(`   Auto Subtitles: DISABLED`);
    }
    console.log(`${'='.repeat(50)}`);

    let videoPath = null;
    let audioPath = null;

    try {
      // Periksa apakah ada transkrip eksternal (misal hasil copy dari fitur Tanya Gemini YouTube)
      let preParsedTranscript = null;
      if (typeof transcriptText === 'string' && transcriptText.trim().length > 0) {
        try {
          console.log(`⚡ Memproses transkrip kustom / Tanya Gemini...`);
          preParsedTranscript = parseGeminiTranscript(transcriptText);
        } catch (parseErr) {
          console.warn(`⚠️ Gagal mem-parsing transkrip teks: ${parseErr.message}`);
        }
      }

      // STEP 1: Ambil info & metadata video (selalu skip unduh audio di awal agar super cepat)
      await job.updateProgress({ step: 1, message: 'Menyiapkan metadata video...', percent: 5 });

      const downloaded = await downloadVideo(url, jobId, {
        skipAudioDownload: true,
      });
      videoPath = downloaded.videoPath;

      console.log(`\n📹 Video: ${downloaded.title} (${downloaded.duration}s)`);

      await job.updateProgress({
        step: 1,
        message: `Video "${downloaded.title}" siap diproses`,
        percent: 25,
        videoTitle: downloaded.title,
        videoDuration: downloaded.duration,
      });

      // STEP 2: Transkripsi (Hierarki Cepat: Kustom/Paste -> Subtitle YouTube -> Gemini Cloud API -> Browser Otomasi -> Whisper Fallback)
      let transcriptData = null;

      // 1. Transkrip Manual / Tempel Tanya Gemini
      if (preParsedTranscript) {
        transcriptData = preParsedTranscript;
        console.log(`⚡ Menggunakan transkrip Tanya Gemini (${transcriptData.sentences.length} kalimat). Melewati unduh audio & Whisper!`);
      }

      // 2. Subtitle Bawaan YouTube
      const hasInstantSubs = Boolean(downloaded.subtitles && downloaded.subtitles.words?.length >= 10);
      if (!transcriptData && hasInstantSubs) {
        console.log(`⚡ Menggunakan subtitle instan YouTube (${downloaded.subtitles.words.length} kata)`);
        await job.updateProgress({ step: 2, message: 'Memproses transkrip instan YouTube...', percent: 30 });
        transcriptData = await transcribeAudio(null, {
          mockTranscript: downloaded.subtitles,
        });
      }

      // 3. Automated Gemini API Video Understanding (cloud direct, ~10s)
      if (!transcriptData) {
        await job.updateProgress({ step: 2, message: 'Mencoba transkripsi cloud via Gemini API...', percent: 30 });
        const geminiTranscript = await fetchGeminiApiTranscript(url, {
          duration: downloaded.duration,
          language: downloaded.language,
        });
        if (geminiTranscript) {
          transcriptData = geminiTranscript;
        }
      }

      // 4. Browser Otomasi via Camoufox (coba klik Tanya / panel transkrip YouTube)
      if (!transcriptData) {
        await job.updateProgress({ step: 2, message: 'Mencoba ekstraksi otomatis via browser...', percent: 35 });
        const browserTranscript = await extractTranscriptViaBrowser(url, {
          duration: downloaded.duration,
          language: downloaded.language,
        });
        if (browserTranscript) {
          transcriptData = browserTranscript;
        }
      }

      // 5. Fallback Terakhir: Unduh audio stream & jalankan Whisper
      if (!transcriptData) {
        console.log(`ℹ️ Seluruh jalur instan tidak tersedia. Mengunduh stream audio untuk transkripsi AI...`);
        await job.updateProgress({ step: 2, message: 'Mengunduh audio untuk transkripsi AI...', percent: 40 });
        const audioInfo = await downloadAudioAndInfo(url, jobId, { skipAudioDownload: false });

        if (audioInfo.subtitles && Array.isArray(audioInfo.subtitles.words) && audioInfo.subtitles.words.length >= 10) {
          console.log(`⚡ Subtitle instan ditemukan pada saat download audio (${audioInfo.subtitles.words.length} kata)! Melewati Whisper.`);
          transcriptData = await transcribeAudio(null, {
            mockTranscript: audioInfo.subtitles,
          });
        } else {
          audioPath = audioInfo.audioPath;
          if (!audioPath || !fs.existsSync(audioPath)) {
            throw new Error(`File audio tidak ditemukan setelah pengunduhan: ${audioPath}`);
          }

          await job.updateProgress({ step: 2, message: 'Mentranskripsi audio dengan AI...', percent: 50 });
          transcriptData = await transcribeAudio(audioPath, {
            onStatus: async ({ message, percent }) => {
              await job.updateProgress({
                step: 2,
                message,
                percent: percent || 50,
              });
            },
          });
        }
      }

      const {
        text,
        segments,
        words = [],
        sentences = [],
        silenceIntervals = [],
        speakerTurns = [],
      } = transcriptData;

      const resolvedLang = (transcriptData.language && transcriptData.language !== 'auto' && transcriptData.language !== 'unknown')
        ? transcriptData.language
        : ((downloaded.language && downloaded.language !== 'auto' && downloaded.language !== 'unknown')
          ? downloaded.language
          : detectLanguageFromText(text || '', downloaded.language || 'id'));
      const language = normalizeLanguageCode(resolvedLang);

      if (!text || text.trim().length < 10) {
        throw new Error('Transkripsi gagal atau video tidak memiliki dialog yang cukup.');
      }

      await job.updateProgress({
        step: 2,
        message: `Transkripsi selesai (${language.toUpperCase()}, ${sentences.length || segments.length} segment/kalimat)`,
        percent: 55,
      });

      // Deteksi Audio Hype / Excitement Peaks jika file audio tersedia (Milestone 3)
      let enrichedSentences = sentences;
      if (audioPath && fs.existsSync(audioPath)) {
        try {
          const { peaks } = await detectAudioPeaks(audioPath);
          if (peaks && peaks.length > 0) {
            enrichedSentences = annotateSentencesWithAudioPeaks(sentences, peaks);
            console.log(`🔥 [videoWorker] Terdeteksi ${peaks.length} zona audio hype! Kalimat telah dianotasi.`);
          }
        } catch (peakErr) {
          console.warn(`⚠️ [videoWorker] Audio peak detector notice: ${peakErr.message}`);
        }
      }

      // STEP 3: AI Analisis (dengan Discrete Sentence ID & Boundary Snapping)
      await job.updateProgress({ step: 3, message: 'AI sedang menganalisis momen terbaik...', percent: 60 });
      const aiClips = await analyzeTranscript(text, segments, downloaded.duration, clipCount, {
        words,
        sentences: enrichedSentences,
        silences: silenceIntervals,
        language,
      });

      if (aiClips.length === 0) {
        throw new Error('AI tidak menemukan segmen yang cocok. Coba video yang lebih panjang.');
      }

      await job.updateProgress({
        step: 3,
        message: `AI menemukan ${aiClips.length} momen terbaik`,
        percent: 70,
        clips: aiClips.map((c) => ({
          title: c.title,
          score: c.score || c.viralityScore,
          duration: Math.round(c.end - c.start),
          hook: c.hookClassification,
        })),
      });

      // STEP 4: Proses klip (dengan audio crossfade, smooth easing & auto subtitles)
      await job.updateProgress({ step: 4, message: 'Memotong dan memproses video...', percent: 75 });
      const processedClips = await processClips(videoPath, aiClips, jobId, aspectRatio, {
        speakerTurns,
        words: transcriptData.words,
        subtitleConfig,
        layoutMode,
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
        reason: c.reason || c.viralityRationale,
        score: c.score || c.viralityScore,
        hookClassification: c.hookClassification,
        hookText: c.hookText,
        narrativeRationale: c.narrativeRationale,
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
