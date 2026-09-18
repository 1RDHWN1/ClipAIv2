// routes/api.js
import express from 'express';
import { videoQueue } from '../queues/videoQueue.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Validasi YouTube URL
function isValidYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const isYouTubeHost = /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname);
    if (!isYouTubeHost) return false;
    return (
      u.searchParams.has('v') ||
      u.pathname.startsWith('/shorts/') ||
      u.pathname.startsWith('/live/') ||
      u.hostname.toLowerCase().includes('youtu.be')
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/process
 * Mulai proses video baru
 */
router.post('/process', async (req, res) => {
  try {
    const { url, aspectRatio = '9:16', clipCount = 3, transcriptText, subtitleConfig } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL YouTube wajib diisi' });
    }

    if (!isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'URL tidak valid. Masukkan URL YouTube yang benar.' });
    }

    if (!['9:16', '1:1', '16:9'].includes(aspectRatio)) {
      return res.status(400).json({ error: 'Aspect ratio harus: 9:16, 1:1, atau 16:9' });
    }

    const count = Math.min(5, Math.max(1, parseInt(clipCount) || 3));
    const jobId = uuidv4();
    const cleanTranscript = typeof transcriptText === 'string' && transcriptText.trim().length > 0
      ? transcriptText.trim()
      : null;

    // Normalisasi konfigurasi subtitle jika disediakan
    let cleanSubtitleConfig = null;
    if (subtitleConfig && typeof subtitleConfig === 'object') {
      cleanSubtitleConfig = {
        enabled: subtitleConfig.enabled !== false,
        preset: subtitleConfig.preset || 'hormozi',
        fontFamily: subtitleConfig.fontFamily || undefined,
        fontSize: subtitleConfig.fontSize ? Number(subtitleConfig.fontSize) : undefined,
        highlightColor: subtitleConfig.highlightColor || undefined,
        primaryColor: subtitleConfig.primaryColor || undefined,
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
