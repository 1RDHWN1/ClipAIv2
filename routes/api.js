// routes/api.js
import express from 'express';
import { videoQueue } from '../queues/videoQueue.js';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeVideoId } from '../utils/downloader.js';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { deleteJobOutputs, reapOutputs } from '../utils/outputReaper.js';

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

    // Normalisasi konfigurasi subtitle jika disediakan
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
    } else if (subtitleConfig === true || subtitleConfig === 'true') {
      cleanSubtitleConfig = { enabled: true, preset: 'hormozi' };
    }

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
      },
      { jobId }
    );

    console.log(`📌 Job added: ${jobId} | URL: ${url} | FastPath: ${Boolean(cleanTranscript)} | Subs: ${Boolean(cleanSubtitleConfig?.enabled)}`);

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

export default router;
