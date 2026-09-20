// routes/api.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { videoQueue } from '../queues/videoQueue.js';
import { clearQueue, getQueueCounts } from '../queues/videoQueue.js';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeVideoId } from '../utils/downloader.js';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { deleteJobOutputs, reapOutputs } from '../utils/outputReaper.js';
import { detectHardwareAcceleration } from '../utils/gpuDetector.js';
import { normalizeMetadataMode, VALID_METADATA_MODES } from '../utils/metadataGenerator.js';
import { normalizeBrandingConfig, brandingIsActive } from '../utils/brandingOverlay.js';

const router = express.Router();

// Rate limit untuk endpoint yang memicu kerja berat (unduh + render).
// Job video itu mahal (CPU, bandwidth, disk), jadi satu klien tidak boleh
// membanjiri queue. Nilai default sengaja longgar untuk pemakaian normal.
const processRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
  message: 'Terlalu banyak permintaan proses video. Tunggu sebentar lalu coba lagi.',
});

// Batas panjang transkrip yang diterima dari klien. Tanpa ini, payload raksasa
// bisa dipakai untuk menghabiskan memori (body limit express.json menahan
// ukuran request, tapi isi teks tetap perlu batas logis tersendiri).
const MAX_TRANSCRIPT_CHARS = parseInt(process.env.MAX_TRANSCRIPT_CHARS || '200000', 10);

// API key opsional. Bila API_KEY di-set, semua endpoint tulis wajib
// melampirkan header x-api-key yang cocok. Bila tidak di-set (default dev),
// server berjalan terbuka — TAPI ini harus diisi sebelum diekspos ke internet.
const API_KEY = process.env.API_KEY || null;

/**
 * Middleware auth opsional. Aktif hanya bila API_KEY dikonfigurasi.
 */
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.get('x-api-key');
  if (provided && provided === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized: x-api-key tidak valid atau tidak ada.' });
}

/**
 * Validasi YouTube URL.
 *
 * Sejak audit keamanan, validasi TIDAK lagi hanya mengecek hostname: kita
 * mensyaratkan video id yang benar-benar dapat diekstrak dan berbentuk sah
 * (11 karakter [A-Za-z0-9_-]). Ini mencegah string aneh lolos ke worker.
 */
function isValidYouTubeUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const u = new URL(url);
    const isYouTubeHost = /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname);
    if (!isYouTubeHost) return false;

    let videoId = '';
    if (u.hostname.toLowerCase().includes('youtu.be')) {
      videoId = u.pathname.replace(/^\//, '').split('/')[0];
    } else if (u.searchParams.has('v')) {
      videoId = u.searchParams.get('v');
    } else if (u.pathname.startsWith('/shorts/')) {
      videoId = u.pathname.split('/shorts/')[1]?.split('/')[0] || '';
    } else if (u.pathname.startsWith('/live/')) {
      videoId = u.pathname.split('/live/')[1]?.split('/')[0] || '';
    } else if (u.pathname.startsWith('/embed/')) {
      videoId = u.pathname.split('/embed/')[1]?.split('/')[0] || '';
    }

    return sanitizeVideoId(videoId) !== null;
  } catch {
    return false;
  }
}

/**
 * POST /api/process
 * Mulai proses video baru
 */
router.post('/process', requireApiKey, processRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { url, aspectRatio = '9:16', clipCount = 3, transcriptText, subtitleConfig, layoutMode = 'standard' } = body;
    const metadataMode = body.metadataMode;
    const targetPlatform = body.targetPlatform;

    if (!url) {
      return res.status(400).json({ error: 'URL YouTube wajib diisi' });
    }

    if (!isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'URL tidak valid. Masukkan URL YouTube yang benar.' });
    }

    if (!['9:16', '1:1', '16:9'].includes(aspectRatio)) {
      return res.status(400).json({ error: 'Aspect ratio harus: 9:16, 1:1, atau 16:9' });
    }

    const validLayouts = ['standard', 'split_screen', 'auto_split', 'gaming_streamer'];
    const cleanLayoutMode = validLayouts.includes(layoutMode) ? layoutMode : 'auto_split';

    const count = Math.min(5, Math.max(1, parseInt(clipCount) || 3));
    const jobId = uuidv4();

    if (typeof transcriptText === 'string' && transcriptText.length > MAX_TRANSCRIPT_CHARS) {
      return res.status(413).json({
        error: `Transkrip terlalu panjang (maks ${MAX_TRANSCRIPT_CHARS} karakter).`,
      });
    }

    const cleanTranscript = typeof transcriptText === 'string' && transcriptText.trim().length > 0
      ? transcriptText.trim()
      : null;

    // Normalisasi konfigurasi subtitle.
    //
    // PENTING: default-nya HARUS sama dengan default UI (checkbox "Auto
    // Subtitles" aktif). Sebelumnya, kalau klien tidak mengirim subtitleConfig
    // sama sekali, subtitle diam-diam MATI — video keluar tanpa takarir dan
    // tidak ada satu pun pesan error yang menjelaskan kenapa. Default yang
    // konsisten membuat perilakunya bisa diprediksi.
    let cleanSubtitleConfig = null;
    if (subtitleConfig && typeof subtitleConfig === 'object') {
      const rawFontSize = subtitleConfig.fontSize ? Number(subtitleConfig.fontSize) : undefined;
      cleanSubtitleConfig = {
        enabled: subtitleConfig.enabled !== false,
        preset: typeof subtitleConfig.preset === 'string' ? subtitleConfig.preset : 'hormozi',
        fontFamily: typeof subtitleConfig.fontFamily === 'string' ? subtitleConfig.fontFamily : undefined,
        fontSize: Number.isFinite(rawFontSize) ? rawFontSize : undefined,
        highlightColor: typeof subtitleConfig.highlightColor === 'string' ? subtitleConfig.highlightColor : undefined,
        primaryColor: typeof subtitleConfig.primaryColor === 'string' ? subtitleConfig.primaryColor : undefined,
        position: subtitleConfig.position || 'bottom',
      };
    } else if (subtitleConfig === false || subtitleConfig === 'false') {
      // Dimatikan secara eksplisit.
      cleanSubtitleConfig = { enabled: false, preset: 'hormozi' };
    } else {
      // Tidak dikirim / true -> ikuti default UI (aktif).
      cleanSubtitleConfig = { enabled: true, preset: 'hormozi' };
    }

    // Normalisasi parameter AI Model jika disediakan
    let cleanAiModel = null;
    if (typeof body.aiModel === 'string' && body.aiModel.trim().length > 0) {
      const candidate = body.aiModel.trim();
      if (/^[a-zA-Z0-9_.:\/-]{1,100}$/.test(candidate)) {
        cleanAiModel = candidate;
      }
    }

    // Normalisasi mode metadata (judul/deskripsi/hashtag). Mode tak dikenal
    // jatuh ke default ('viral') — bukan mati diam-diam.
    const cleanMetadataMode = normalizeMetadataMode(metadataMode);

    const validPlatforms = ['all', 'tiktok', 'shorts', 'reels'];
    const cleanTargetPlatform = validPlatforms.includes(targetPlatform)
      ? targetPlatform
      : 'all';

    // Normalisasi branding (atribusi sumber + watermark channel). Nama channel
    // sumber diisi otomatis dari metadata YouTube kalau user tidak menimpanya.
    const cleanBranding = normalizeBrandingConfig(body.branding);

    const job = await videoQueue.add(
      'process-video',
      {
        url,
        aspectRatio,
        clipCount: count,
        transcriptText: cleanTranscript,
        jobId,
        subtitleConfig: cleanSubtitleConfig,
        layoutMode: cleanLayoutMode,
        aiModel: cleanAiModel,
        metadataMode: cleanMetadataMode,
        targetPlatform: cleanTargetPlatform,
        branding: cleanBranding,
      },
      { jobId }
    );

    console.log(`📌 Job added: ${jobId} | URL: ${url} | FastPath: ${Boolean(cleanTranscript)} | Subs: ${Boolean(cleanSubtitleConfig?.enabled)} | Model: ${cleanAiModel || 'default'} | Metadata: ${cleanMetadataMode}/${cleanTargetPlatform} | Branding: ${brandingIsActive(cleanBranding) ? 'on' : 'off'}`);

    res.json({
      success: true,
      jobId,
      message: cleanTranscript
        ? 'Video sedang diproses menggunakan transkrip instan (Mode Cepat).'
        : 'Video sedang diproses. Gunakan jobId untuk cek status.',
      estimatedTime: cleanTranscript ? '30-60 detik' : '2-5 menit',
    });
  } catch (err) {
    console.error('POST /process error:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

/**
 * GET /api/job/:jobId
 * Cek status job
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await videoQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job tidak ditemukan atau sudah kedaluwarsa' });
    }

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const progress = job.progress || {};

    const response = {
      jobId,
      state,
      progress,
      createdAt: new Date(job.timestamp).toISOString(),
    };

    if (state === 'completed') {
      response.result = job.returnvalue;
    }

    if (state === 'failed') {
      response.error = job.failedReason;
    }

    res.json(response);
  } catch (err) {
    console.error('GET /job error:', err);
    res.status(500).json({ error: 'Gagal mendapatkan status job', detail: err.message });
  }
});

/**
 * DELETE /api/job/:jobId
 * Hapus file output sebuah job dan bersihkan job dari queue (audit H7).
 *
 * Sebelum ini tidak ada cara menghapus hasil render sama sekali: file .mp4
 * menumpuk tanpa batas sampai disk penuh.
 */
router.delete('/job/:jobId', requireApiKey, async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(jobId))) {
      return res.status(400).json({ error: 'jobId tidak valid' });
    }

    const files = deleteJobOutputs(jobId);

    // Job metadata di Redis juga dibersihkan bila masih ada.
    let queueRemoved = false;
    try {
      const job = await videoQueue.getJob(jobId);
      if (job) {
        await job.remove();
        queueRemoved = true;
      }
    } catch (_) {
      // Job mungkin sudah kedaluwarsa dari Redis — bukan error fatal.
    }

    console.log(`🗑️  Job ${jobId} dihapus: ${files.deleted.length} file, ${(files.freedBytes / 1024 / 1024).toFixed(2)}MB`);

    res.json({
      success: true,
      jobId,
      deletedFiles: files.deleted,
      deletedCount: files.deleted.length,
      freedMB: (files.freedBytes / 1024 / 1024).toFixed(2),
      queueJobRemoved: queueRemoved,
    });
  } catch (err) {
    console.error('DELETE /job error:', err);
    res.status(500).json({ error: 'Gagal menghapus job', detail: err.message });
  }
});

/**
 * POST /api/maintenance/reap
 * Jalankan pembersihan output secara manual. `?dryRun=1` hanya melaporkan.
 */
router.post('/maintenance/reap', requireApiKey, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const result = reapOutputs({ dryRun });
    res.json({
      success: true,
      dryRun,
      scanned: result.scanned,
      deletedCount: result.deleted.length,
      freedMB: (result.freedBytes / 1024 / 1024).toFixed(2),
      deletedFiles: result.deleted,
    });
  } catch (err) {
    console.error('POST /maintenance/reap error:', err);
    res.status(500).json({ error: 'Gagal menjalankan reaper', detail: err.message });
  }
});

/**
 * GET /api/queue/stats
 * Statistik queue (opsional, untuk monitoring)
 */
router.get('/queue/stats', async (req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      videoQueue.getWaitingCount(),
      videoQueue.getActiveCount(),
      videoQueue.getCompletedCount(),
      videoQueue.getFailedCount(),
    ]);

    res.json({ waiting, active, completed, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/models
 * Mengambil daftar model AI yang tersedia dari gateway lokal 9Router atau presets
 */
router.get('/models', async (req, res) => {
  try {
    const { resolveModelConfiguration } = await import('../utils/analyzer.js');
    const config = resolveModelConfiguration();
    const defaultModel = config.model;

    let availableModels = [];

    // Probe endpoint /v1/models dari gateway yang terkonfigurasi (misal 9Router :20128)
    if (config.baseUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const probeRes = await fetch(`${config.baseUrl}/models`, {
          headers: {
            'Authorization': `Bearer ${config.apiKey || 'dummy'}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (probeRes.ok) {
          const data = await probeRes.json();
          if (Array.isArray(data.data)) {
            availableModels = data.data.map(m => m.id).filter(Boolean);
          }
        }
      } catch (_) {
        // Fallback jika gateway tidak merespons
      }
    }

    // Daftar preset rekomendasi model terpopuler & efisien.
    // `defaultModel` diambil dari env (DEFAULT_MODEL), jadi default di sini
    // otomatis mengikuti konfigurasi — jangan hardcode model lama di daftar.
    const presetModels = [
      defaultModel,
      'cbai/deepseek-v4.1-flash',
      'xkiro/google/gemini-3.8-flash',
      'xkiro/google/gemini-3.1-pro',
      'kr/claude-sonnet-4.5',
      'kimchi/deepseek-v4-flash-0731',
    ].filter(Boolean);

    const merged = Array.from(new Set([...presetModels, ...availableModels]));

    res.json({
      success: true,
      defaultModel,
      models: merged,
      metadataModes: VALID_METADATA_MODES,
      defaultMetadataMode: normalizeMetadataMode(undefined),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil daftar model AI', detail: err.message });
  }
});

/**
 * GET /api/jobs
 * Daftar job TERBARU (semua status) — dipakai UI supaya riwayat tidak hilang
 * saat halaman di-refresh.
 *
 * Sebelumnya UI hanya menyimpan jobId di memori: begitu di-refresh, halaman
 * kembali ke form kosong dan hasil render tidak bisa dijangkau lagi — padahal
 * file-nya masih ada di disk. Endpoint ini membuat hasil bisa dipulihkan.
 */
router.get('/jobs', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const states = ['active', 'waiting', 'delayed', 'completed', 'failed'];

    const jobs = await videoQueue.getJobs(states, 0, limit - 1, false);
    jobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const outputsDir = process.env.OUTPUT_DIR || path.join(process.cwd(), 'outputs');
    let availableDiskFiles = [];
    try {
      if (fs.existsSync(outputsDir)) {
        availableDiskFiles = fs.readdirSync(outputsDir);
      }
    } catch (_) {}

    const summaries = [];
    for (const job of jobs.slice(0, limit)) {
      let state = 'unknown';
      try { state = await job.getState(); } catch (_) {}

      let clips = Array.isArray(job.returnvalue?.clips) ? [...job.returnvalue.clips] : [];

      // Jika returnvalue belum memiliki klip, periksa disk apakah ada klip MP4
      // yang sudah selesai dirender untuk job ini (misal job terputus di klip 3).
      if (clips.length === 0 && availableDiskFiles.length > 0) {
        const matching = availableDiskFiles.filter(
          (f) => f.startsWith(`${job.id}_clip`) && f.endsWith('.mp4')
        );
        if (matching.length > 0) {
          clips = matching.map((f, idx) => {
            const fullPath = path.join(outputsDir, f);
            let sizeMB = '0';
            try {
              const st = fs.statSync(fullPath);
              sizeMB = (st.size / (1024 * 1024)).toFixed(2);
            } catch (_) {}
            const titlePart = f.replace(`${job.id}_clip`, '').replace('.mp4', '').split('_');
            const clipIdx = parseInt(titlePart[0], 10) || (idx + 1);
            const title = titlePart.slice(1).join(' ') || `Clip ${clipIdx}`;
            return {
              index: clipIdx,
              title,
              filename: f,
              downloadUrl: `/outputs/${encodeURIComponent(f)}`,
              fileSizeMB: sizeMB,
            };
          });
        }
      }

      summaries.push({
        jobId: job.id,
        url: job.data?.url || null,
        state,
        createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        percent: job.progress?.percent ?? null,
        step: job.progress?.step ?? null,
        message: job.progress?.message ?? null,
        videoTitle: job.returnvalue?.videoTitle || job.progress?.videoTitle || null,
        // Bahasa konten — UI memakainya untuk memilih bahasa fallback metadata.
        language: job.returnvalue?.language || null,
        clipCount: job.data?.clipCount ?? null,
        clips,
        result: job.returnvalue?.success ? job.returnvalue : (clips.length > 0 ? { success: true, clips } : null),
        failedReason: job.failedReason || null,
      });
    }

    res.json({ success: true, count: summaries.length, jobs: summaries });
  } catch (err) {
    console.error('GET /jobs error:', err);
    res.status(500).json({ error: 'Gagal membaca daftar job', detail: err.message });
  }
});

/**
 * POST /api/queue/clear
 * Batalkan SEMUA job yang masih menunggu/berjalan.
 *
 * Dipakai tombol "Stop Semua" — supaya job yang tertinggal dari sesi sebelumnya
 * tidak diam-diam dilanjutkan saat aplikasi dijalankan lagi.
 */
router.post('/queue/clear', requireApiKey, async (req, res) => {
  try {
    const before = await getQueueCounts();
    const result = await clearQueue();
    const after = await getQueueCounts();

    console.log(`🧹 Queue dibersihkan — sebelum: ${JSON.stringify(before)}, sesudah: ${JSON.stringify(after)}`);

    res.json({
      success: true,
      message: 'Semua job di antrian dibatalkan.',
      before,
      after,
      cleared: (before.waiting + before.delayed + before.active),
    });
  } catch (err) {
    console.error('POST /queue/clear error:', err);
    res.status(500).json({ error: 'Gagal membersihkan antrian', detail: err.message });
  }
});

/**
 * GET /api/queue
 * Ringkasan isi antrian — dipakai UI untuk menampilkan status job tertinggal.
 */
router.get('/queue', async (req, res) => {
  try {
    const counts = await getQueueCounts();
    res.json({ success: true, counts, pending: counts.waiting + counts.active + counts.delayed });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca antrian', detail: err.message });
  }
});

/**
 * GET /api/hardware
 * Mengembalikan status akselerasi perangkat keras (GPU VAAPI / CPU)
 */
router.get('/hardware', (req, res) => {
  try {
    const info = detectHardwareAcceleration();
    res.json({
      success: true,
      ...info,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mendeteksi hardware acceleration', detail: err.message });
  }
});

export default router;
