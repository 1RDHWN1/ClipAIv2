// workers/videoWorker.js
import fs from 'fs';
import { Worker } from 'bullmq';
import { redisConnection } from '../queues/videoQueue.js';
import { downloadVideo, downloadAudioAndInfo, cleanupFiles } from '../utils/downloader.js';
import { startOutputReaper } from '../utils/outputReaper.js';
import { transcribeAudio, detectLanguageFromText, normalizeLanguageCode } from '../utils/transcriber.js';
import { parseGeminiTranscript } from '../utils/geminiTranscriptParser.js';
import { fetchGeminiApiTranscript } from '../utils/geminiVideoProvider.js';
import { extractTranscriptViaBrowser } from '../utils/youtubeAutomation.js';
import { analyzeTranscript } from '../utils/analyzer.js';
import { generateClipMetadata, applyMetadataToClips } from '../utils/metadataGenerator.js';
import { buildClipTranscriptSlice } from '../utils/transcriptSlice.js';
import { processClips } from '../utils/clipper.js';
import { detectAudioPeaks, annotateSentencesWithAudioPeaks } from '../utils/audioPeakDetector.js';
import 'dotenv/config';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);

console.log('🚀 Video Worker starting...');

const worker = new Worker(
  'video-processing',
  async (job) => {
    const { url, aspectRatio, clipCount = 3, transcriptText, subtitleConfig, layoutMode = 'standard', jobId = job.id, aiModel, metadataMode = 'viral', targetPlatform = 'all', branding } = job.data;

    // Track warnings for transparency about fallbacks and processing path
    const warnings = [];
    const addWarning = (msg) => { warnings.push(msg); console.warn(`⚠️ [${jobId}] ${msg}`); };

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
    if (aiModel) {
      console.log(`   AI Model Override: ${aiModel}`);
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
      let transcriptSource = 'unknown';

      // 1. Transkrip Manual / Tempel Tanya Gemini
      if (preParsedTranscript) {
        transcriptData = preParsedTranscript;
        transcriptSource = 'manual_paste';
        console.log(`⚡ Menggunakan transkrip Tanya Gemini (${transcriptData.sentences.length} kalimat). Melewati unduh audio & Whisper!`);
      }

      // 2. Subtitle Bawaan YouTube
      const hasInstantSubs = Boolean(downloaded.subtitles && downloaded.subtitles.words?.length >= 10);
      if (!transcriptData && hasInstantSubs) {
        transcriptSource = 'youtube_subtitles';
        addWarning(`Using YouTube auto-generated subtitles (${downloaded.subtitles.words.length} words) - accuracy may vary`);
        console.log(`⚡ Menggunakan subtitle instan YouTube (${downloaded.subtitles.words.length} kata)`);
        await job.updateProgress({ step: 2, message: 'Memproses transkrip instan YouTube...', percent: 30 });
        transcriptData = await transcribeAudio(null, {
          mockTranscript: downloaded.subtitles,
        });
      }

      // 3. Automated Gemini API Video Understanding (cloud direct, ~10s)
      if (!transcriptData) {
        transcriptSource = 'gemini_api';
        addWarning('Using Gemini API video understanding fallback - may miss speaker diarization');
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
        transcriptSource = 'browser_automation';
        addWarning('Using browser automation (Camoufox) - slower and may break if YouTube changes UI');
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
        transcriptSource = 'whisper_audio';
        addWarning('All instant paths failed - falling back to audio download + Whisper transcription (slowest path)');
        console.log(`ℹ️ Seluruh jalur instan tidak tersedia. Mengunduh stream audio untuk transkripsi AI...`);
        await job.updateProgress({ step: 2, message: 'Mengunduh audio untuk transkripsi AI...', percent: 40 });
        const audioInfo = await downloadAudioAndInfo(url, jobId, { skipAudioDownload: false });
        // Audit H6: downloadAudioAndInfo ALWAYS writes the mp3 and returns its
        // path. Previously audioPath was only assigned in the `else` branch, so
        // whenever YouTube subtitles were found during the download the mp3 was
        // never handed to cleanupFiles and leaked on disk. Register it for
        // cleanup the moment it exists, before any branch can skip past it.
        audioPath = audioInfo.audioPath;

        if (audioInfo.subtitles && Array.isArray(audioInfo.subtitles.words) && audioInfo.subtitles.words.length >= 10) {
          transcriptSource = 'audio_download_subtitles';
          addWarning('Found subtitles during audio download - skipping Whisper');
          console.log(`⚡ Subtitle instan ditemukan pada saat download audio (${audioInfo.subtitles.words.length} kata)! Melewati Whisper.`);
          transcriptData = await transcribeAudio(null, {
            mockTranscript: audioInfo.subtitles,
          });
        } else {
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
      } else {
        // Fast path: gunakan keyword-based hype detection sebagai proxy
        try {
          const { annotateSentencesWithKeywordHype } = await import('../utils/sentenceSegmenter.js');
          enrichedSentences = annotateSentencesWithKeywordHype(sentences, language);
          const hypeCount = enrichedSentences.filter(s => s.isHypePeak).length;
          if (hypeCount > 0) {
            console.log(`🔥 [videoWorker] Keyword-based hype detection: ${hypeCount} kalimat dengan hype peak (proxy).`);
          }
        } catch (kwErr) {
          console.warn(`⚠️ [videoWorker] Keyword hype detection notice: ${kwErr.message}`);
        }
      }

      // STEP 3: AI Analisis (dengan Discrete Sentence ID & Boundary Snapping)
      await job.updateProgress({ step: 3, message: 'AI sedang menganalisis momen terbaik...', percent: 60 });
      const aiClips = await analyzeTranscript(text, segments, downloaded.duration, clipCount, {
        words,
        sentences: enrichedSentences,
        silences: silenceIntervals,
        language,
        aiModel,
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

      // Branding: nama channel sumber diambil dari metadata YouTube, tapi TIDAK
      // menimpa nilai yang sudah diisi user secara eksplisit di form.
      const resolvedBranding = branding
        ? {
            ...branding,
            sourceChannel: branding.sourceChannel || downloaded.channelName || null,
          }
        : null;

      const processedClips = await processClips(videoPath, aiClips, jobId, aspectRatio, {
        speakerTurns,
        words: transcriptData.words,
        subtitleConfig,
        layoutMode,
        branding: resolvedBranding,
      });

      await job.updateProgress({
        step: 4,
        message: `${processedClips.length} clip berhasil dibuat!`,
        percent: 95,
      });

      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

      // STEP 5: Metadata publikasi viral (judul, deskripsi, hashtag, caption).
      // Dibungkus try/catch dengan sengaja: metadata yang gagal TIDAK BOLEH
      // menggagalkan render yang sudah selesai. Kalau gateway mati atau model
      // mengembalikan sampah, klip tetap tersimpan dengan judul dari analyzer.
      await job.updateProgress({ step: 5, message: 'AI menyusun judul & deskripsi viral...', percent: 96 });

      let clipsWithMetadata = processedClips;
      try {
        const clipInputs = processedClips.map((c) => {
          const idx = c.clipIndex ?? c.index;
          // Slice transkrip klip ini supaya model menulis dari isi sebenarnya,
          // bukan menebak dari judul sementara.
          const clipText = buildClipTranscriptSlice(enrichedSentences, c.start, c.end);
          return {
            index: idx,
            title: c.title,
            hookText: c.hookText,
            viralityRationale: c.viralityRationale,
            duration: c.duration,
            clipText,
          };
        });

        const metadataByIndex = await generateClipMetadata(clipInputs, {
          aiModel,
          language,
          metadataMode,
          videoTitle: downloaded.title,
          targetPlatform,
        });

        clipsWithMetadata = applyMetadataToClips(processedClips, metadataByIndex);

        if (metadataByIndex.size === 0 && metadataMode !== 'off') {
          addWarning(`Metadata publikasi tidak dapat digenerate — memakai judul dari analisis klip.`);
        }
      } catch (metaErr) {
        addWarning(`Metadata generator error (${metaErr.message}) — memakai judul dari analisis klip.`);
      }

      const finalClips = clipsWithMetadata.map((c) => ({
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
        // Metadata publikasi siap-tempel (null kalau mode off / generator gagal)
        metadata: c.metadata || null,
      }));

      console.log(`\n✅ Job ${jobId} SELESAI! ${finalClips.length} clips generated.`);

      return {
        success: true,
        jobId,
        videoTitle: downloaded.title,
        videoDuration: downloaded.duration,
        language,
        transcriptSource,
        warnings: warnings.length > 0 ? warnings : undefined,
        clips: finalClips,
      };
    } catch (err) {
      console.error(`❌ Job ${jobId} GAGAL:`, err.message);
      throw err;
    } finally {
      // Audit H6: cleanup runs on EVERY exit path (success, throw, or an early
      // return) instead of only the happy path and the catch block.
      //
      // Only local files are removed: `videoPath` is the YouTube URL (the clipper
      // downloads per-section itself), so passing it to unlink was a no-op that
      // made the cleanup look like it covered more than it did.
      const localArtifacts = [videoPath, audioPath].filter(
        (p) => typeof p === 'string' && !p.startsWith('http://') && !p.startsWith('https://')
      );
      if (localArtifacts.length > 0) {
        cleanupFiles(...localArtifacts);
        console.log('🧹 Temporary files cleaned up');
      }
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

// ── Output lifecycle (audit finding H7) ─────────────────────────────────────
// Rendered clips are never removed by BullMQ (removeOnComplete only prunes Redis
// job metadata), so outputs/ grew unbounded — 501 MB with no retention policy.
// The reaper prunes intermediate artifacts aggressively and final clips by TTL /
// total-size budget. It is unref'd so it never keeps the process alive.
const outputReaper = startOutputReaper({ runImmediately: true });
console.log(
  `🧹 Output reaper active (TTL ${process.env.OUTPUT_TTL_HOURS || 24}h, ` +
  `budget ${process.env.OUTPUT_MAX_TOTAL_MB || 5 * 1024}MB, ` +
  `interval ${process.env.OUTPUT_REAP_INTERVAL_MINUTES || 30}m)`
);

// Graceful shutdown
// NOTE: `worker.close()` resolves once BullMQ releases its connections, but the
// Node event loop can still hold other handles (Redis reconnect timers, etc.).
// We must explicitly `process.exit()` afterwards or the process lingers forever
// and the parent `start-all.js` shutdown never completes.
async function gracefulShutdown(signal) {
  console.log(`\n[worker] ${signal} received — closing worker...`);
  try {
    outputReaper.stop();
    await worker.close();
    console.log('[worker] Worker closed gracefully.');
  } catch (err) {
    console.error(`[worker] Error during shutdown: ${err.message}`);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Closing the terminal window (or an ssh drop / tmux detach) delivers SIGHUP to
// the foreground process group. Node's default disposition terminates the
// process, which aborted an in-flight render halfway through ("clips ke-putus
// di tengah"). Ignore it: the worker keeps draining the queue and only an
// explicit Ctrl+C / SIGTERM stops it.
process.on('SIGHUP', () => {
  console.log('[worker] SIGHUP received (terminal closed?) — ignoring, render keeps running.');
});

