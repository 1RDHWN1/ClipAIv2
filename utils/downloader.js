// utils/downloader.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { normalizeLanguageCode, detectLanguageFromText } from './transcriber.js';

// SECURITY: `execFile` never invokes a shell, so arguments are passed to the
// binary verbatim. This is the entire reason the downloader no longer uses
// `exec` + template-literal command strings: a crafted query string such as
//   https://youtube.com/watch?v=x$(touch /tmp/pwned)
// used to interpolate straight into `/bin/sh -c` and execute. With execFile the
// same payload arrives as a literal argv entry that yt-dlp simply rejects.
const execFileAsync = promisify(execFile);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

// Baseline flags shared by every yt-dlp invocation.
const YTDLP_BASE_ARGS = ['--no-update', '--js-runtimes', 'node', '--no-playlist'];

/**
 * Validate a YouTube video id.
 *
 * YouTube ids are exactly 11 characters from [A-Za-z0-9_-]. Validating this
 * shape means the only thing that ever reaches argv is a fixed known-safe
 * token set — a second line of defence behind execFile.
 *
 * @param {unknown} id
 * @returns {string|null} the id if valid, otherwise null
 */
export function sanitizeVideoId(id) {
  if (typeof id !== 'string') return null;
  const candidate = id.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

/**
 * Normalisasi URL YouTube (menghapus tracking token seperti ?si=... yang dapat mengacaukan CDN).
 *
 * Returns a canonical `https://www.youtube.com/watch?v=<id>` when a valid video
 * id can be extracted, otherwise null. Callers MUST refuse to run yt-dlp when
 * this returns null — an unparseable URL is untrusted input.
 */
export function normalizeYouTubeUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    const supportedHost = /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname);
    if (!supportedHost) return null;

    let videoId = '';
    if (u.hostname.toLowerCase().includes('youtu.be')) {
      videoId = u.pathname.replace(/^\//, '').split('/')[0];
    } else if (u.searchParams.has('v')) {
      videoId = u.searchParams.get('v');
    } else if (u.pathname.includes('/shorts/')) {
      videoId = u.pathname.split('/shorts/')[1].split('/')[0];
    } else if (u.pathname.includes('/live/')) {
      videoId = u.pathname.split('/live/')[1].split('/')[0];
    } else if (u.pathname.includes('/embed/')) {
      videoId = u.pathname.split('/embed/')[1].split('/')[0];
    }

    const safeId = sanitizeVideoId(videoId);
    if (!safeId) return null;

    return `https://www.youtube.com/watch?v=${safeId}`;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve a raw URL to a canonical, validated YouTube URL or throw.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function requireSafeUrl(rawUrl) {
  const safe = normalizeYouTubeUrl(rawUrl);
  if (!safe) {
    throw new Error('URL YouTube tidak valid atau video ID tidak dapat diverifikasi.');
  }
  return safe;
}


/**
 * Format detik ke string waktu HH:MM:SS.xx untuk yt-dlp section
 */
function formatSectionTimestamp(seconds) {
  const s = Math.max(0, parseFloat(seconds) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(2);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(5, '0')}`;
}

/**
 * Download HANYA audio dan metadata video YouTube (super cepat, ~5 detik untuk video 1 jam).
 * Dilengkapi proteksi anti-403 Forbidden dengan fallback player client.
 *
 * @param {string} rawUrl - YouTube URL
 * @param {string} jobId - ID job
 * @param {Object} [options={}] - Opsi unduhan
 * @param {boolean} [options.skipAudioDownload=false] - Jika true, hanya ambil info tanpa unduh audio
 * @returns {Promise<{audioPath: string, title: string, duration: number, subtitles: any}>}
 */
export async function downloadAudioAndInfo(rawUrl, jobId, options = {}) {
  const url = requireSafeUrl(rawUrl);
  const outputDir = path.resolve(UPLOAD_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioOutput = path.join(outputDir, `${jobId}_audio.mp3`);

  console.log(`ℹ️ Fetching video info: ${url}`);
  const infoArgs = [
    ...YTDLP_BASE_ARGS,
    '--print', '%(title)s|||%(duration)s|||%(language)s|||%(channel)s|||%(uploader)s',
    '--', url,
  ];
  let title = 'Unknown Video';
  let duration = 0;
  let videoLang = null;
  let channelName = null;

  try {
    const { stdout } = await execFileAsync(YTDLP_BIN, infoArgs, { timeout: 45000 });
    const parts = stdout.trim().split('|||');
    title = parts[0] || 'Unknown Video';
    duration = parseInt(parts[1], 10) || 0;
    const rawLang = parts[2] || '';
    // `channel` is the display name; `uploader` is the fallback when a video has
    // no channel metadata (rare, but it happens on some re-uploads).
    channelName = (parts[3] || parts[4] || '').trim() || null;
    const normLang = normalizeLanguageCode(rawLang);
    if (normLang && normLang !== 'unknown' && normLang !== 'auto') {
      videoLang = normLang;
    } else {
      videoLang = detectLanguageFromText(title);
    }
  } catch (infoErr) {
    console.warn(`⚠️ Gagal mengambil info video, fallback: ${infoErr.message}`);
  }

  // Coba ambil subtitle/caption instan jika ada (sangat cepat ~1-2s, tanpa unduh audio)
  let subtitles = null;
  try {
    subtitles = await fetchYouTubeSubtitles(url, jobId, { videoLang, videoTitle: title });
  } catch (_) {}

  // Jika subtitle instan YouTube berhasil didapatkan, TIDAK PERLU download audio lagi (hemat waktu & kuota)!
  if (subtitles && Array.isArray(subtitles.words) && subtitles.words.length >= 10) {
    console.log(`⚡ Subtitle instan YouTube tersedia (${subtitles.words.length} kata)! Melewati download audio.`);
    return {
      audioPath: null,
      title,
      duration,
      subtitles,
      channelName,
      language: subtitles.language || videoLang || 'id',
    };
  }

  // Jika opsi skipAudioDownload aktif (misal transkrip Gemini disediakan langsung atau mau mencoba jalur cloud)
  if (options.skipAudioDownload) {
    console.log(`⚡ Skip audio download aktif (menggunakan transkrip instan Gemini / Manual / Cloud).`);
    return {
      audioPath: null,
      title,
      duration,
      subtitles: null,
      channelName,
      language: videoLang || 'id',
    };
  }

  console.log(`ℹ️ Video ini tidak menyediakan subtitle otomatis di YouTube. Mengunduh audio untuk transkripsi AI...`);
  console.log(`🎵 Downloading audio stream only (~5-10s): ${url}`);
  
  // Strategi fallback multi-client untuk mengatasi YouTube 403 Forbidden & SABR
  // Setiap entri adalah ARRAY argv (bukan string shell) sehingga execFile
  // meneruskannya ke yt-dlp tanpa pernah menyentuh shell.
  const downloadStrategies = [
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '-f', 'ba[ext=m4a]/ba/bestaudio/140/251',
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '-o', audioOutput, '--', url,
    ],
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '--extractor-args', 'youtube:player_client=web,default',
      '-f', 'ba/bestaudio/140/251',
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '-o', audioOutput, '--', url,
    ],
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '--extractor-args', 'youtube:player_client=android,web',
      '-f', 'ba/bestaudio',
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '-o', audioOutput, '--', url,
    ],
  ];

  let downloaded = false;
  let lastErr = null;

  // Audit H6: if every strategy fails (or a later step throws) the partially
  // written mp3 must not be left behind. The caller cannot clean up a path it
  // never received, so the downloader removes its own failed output.
  const discardPartialAudio = () => {
    try {
      if (fs.existsSync(audioOutput)) fs.unlinkSync(audioOutput);
    } catch (_) {}
  };

  for (let i = 0; i < downloadStrategies.length; i++) {
    const args = downloadStrategies[i];
    try {
      if (i > 0) {
        console.log(`🔄 Retrying audio download with fallback strategy #${i + 1}...`);
      }
      await execFileAsync(YTDLP_BIN, args, { timeout: 180000 });
      if (fs.existsSync(audioOutput) && fs.statSync(audioOutput).size > 1000) {
        downloaded = true;
        break;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ Audio download strategy #${i + 1} notice: ${err.message.substring(0, 100)}...`);
    }
  }

  if (!downloaded) {
    discardPartialAudio();
    throw new Error(`Gagal download audio setelah ${downloadStrategies.length} percobaan: ${lastErr ? lastErr.message : 'Unknown error'}`);
  }

  return {
    audioPath: audioOutput,
    title,
    duration,
    subtitles,
    channelName,
    language: (subtitles && subtitles.language) || videoLang || 'id',
  };
}

/**
 * Memilih file subtitle terbaik dengan memprioritaskan track audio lisan asli (*-orig).
 * Track *-orig adalah penanda resmi YouTube untuk bahasa asli video dan BUKAN terjemahan mesin.
 *
 * @param {string[]} files
 * @param {string} [preferredLang='auto']
 * @param {string} [videoLang=null] - Bahasa asli video dari metadata YouTube (misal 'en' atau 'id')
 * @returns {string|null}
 */
export function selectTargetSubtitleFile(files, preferredLang = 'auto', videoLang = null) {
  if (!Array.isArray(files) || files.length === 0) return null;

  const normalizedPref = (preferredLang || 'auto').toLowerCase();
  const normalizedVideo = (videoLang || '').toLowerCase();

  const matchesLang = (file, lang) => {
    if (!lang || lang === 'auto' || lang === 'unknown') return false;
    const l = lang.toLowerCase();
    return file.includes(`.${l}.`) || file.includes(`.${l}-`) || file.includes(`.${l}_`);
  };

  const matchesOrig = (file, lang = null) => {
    if (!file.includes('-orig.')) return false;
    if (!lang || lang === 'auto' || lang === 'unknown') return true;
    return matchesLang(file, lang);
  };

  // 1. Spoken original audio track (*-orig)
  // Jika user specify preferredLang bukan auto, cek apakah ada *-orig yang match preferredLang
  if (normalizedPref !== 'auto' && normalizedPref !== 'unknown') {
    const prefOrig = files.find(f => matchesOrig(f, normalizedPref));
    if (prefOrig) return prefOrig;
  }

  // Jika ada videoLang dari metadata YouTube, cek *-orig yang match videoLang
  if (normalizedVideo && normalizedVideo !== 'auto' && normalizedVideo !== 'unknown') {
    const videoOrig = files.find(f => matchesOrig(f, normalizedVideo));
    if (videoOrig) return videoOrig;
  }

  // Jika ada *-orig file apapun (YouTube spoken audio caption)
  const anyOrig = files.find(f => f.includes('-orig.'));
  if (anyOrig) return anyOrig;

  // 2. Manual subtitles (atau non-orig subtitles)
  if (normalizedPref === 'en') {
    return files.find(f => matchesLang(f, 'en')) ||
           files.find(f => matchesLang(f, 'id')) ||
           files[0];
  } else if (normalizedPref === 'id') {
    return files.find(f => matchesLang(f, 'id')) ||
           files.find(f => matchesLang(f, 'en')) ||
           files[0];
  }

  // preferredLang adalah 'auto'
  // Jika videoLang terdeteksi (misal 'en'), utamakan subtitle bahasa video!
  if (normalizedVideo && normalizedVideo !== 'auto' && normalizedVideo !== 'unknown') {
    const videoLangMatch = files.find(f => matchesLang(f, normalizedVideo));
    if (videoLangMatch) return videoLangMatch;
  }

  // Auto fallback jika tidak ada videoLang spesifik
  return files.find(f => matchesLang(f, 'id')) ||
         files.find(f => matchesLang(f, 'en')) ||
         files[0];
}

/**
 * Mengambil subtitle/caption langsung dari YouTube tanpa transkripsi manual (hemat waktu 95%).
 * Memprioritaskan track audio lisan original (*-orig) dan memverifikasi bahasa menggunakan analisis teks.
 *
 * @param {string} rawUrl
 * @param {string} jobId
 * @param {Object} [options={}]
 * @param {string} [options.videoLang]
 * @param {string} [options.videoTitle]
 * @returns {Promise<{ words: Array, language: string } | null>}
 */
export async function fetchYouTubeSubtitles(rawUrl, jobId, options = {}) {
  const url = requireSafeUrl(rawUrl);
  const outputDir = path.resolve(UPLOAD_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outTemplate = path.join(outputDir, `${jobId}_sub.%(ext)s`);
  const videoLang = (options.videoLang || '').toLowerCase();

  const listSubFiles = () =>
    fs.readdirSync(outputDir).filter(f => f.startsWith(`${jobId}_sub.`) && f.endsWith('.json3'));

  // Step 1: Coba ambil track subtitle auto-caption original (*-orig).
  // Menggunakan pola ".*-orig" agar hanya mengunduh bahasa lisan asli dan TIDAK memicu terjemahan mesin (anti HTTP 429).
  const origArgs = [
    ...YTDLP_BASE_ARGS, '--skip-download',
    '--write-auto-sub', '--sub-lang', '.*-orig', '--sub-format', 'json3',
    '-o', outTemplate, '--', url,
  ];

  try {
    console.log(`⚡ Mencoba ambil transkrip instan dari YouTube...`);
    await execFileAsync(YTDLP_BIN, origArgs, { timeout: 25000 });
  } catch (_) {}

  let files = listSubFiles();

  // Step 2: Jika tidak ada auto-captions original (*-orig), coba ambil manual subtitles yang diunggah pembuat video.
  // Gunakan --no-write-auto-sub agar tidak mengunduh auto-translations YouTube.
  if (files.length === 0) {
    const manualArgs = [
      ...YTDLP_BASE_ARGS, '--skip-download',
      '--write-sub', '--no-write-auto-sub', '--sub-lang', 'all', '--sub-format', 'json3',
      '-o', outTemplate, '--', url,
    ];
    try {
      await execFileAsync(YTDLP_BIN, manualArgs, { timeout: 25000 });
    } catch (_) {}
    files = listSubFiles();
  }

  // Step 3: Jika tidak ada *-orig dan tidak ada manual subtitles, coba auto-caption standar untuk bahasa video / en / id
  // Tanpa --sub-lang "all" sehingga TIDAK memicu 429
  if (files.length === 0) {
    const targetLangs = [...new Set([videoLang, 'en', 'id'].filter(Boolean))].join(',');
    const fallbackAutoArgs = [
      ...YTDLP_BASE_ARGS, '--skip-download',
      '--write-auto-sub', '--sub-lang', targetLangs, '--sub-format', 'json3',
      '-o', outTemplate, '--', url,
    ];
    try {
      await execFileAsync(YTDLP_BIN, fallbackAutoArgs, { timeout: 25000 });
    } catch (_) {}
    files = listSubFiles();
  }

  if (files.length === 0) return null;

  try {
    const preferredLang = (process.env.TRANSCRIBE_LANGUAGE || 'auto').toLowerCase();
    const targetFile = selectTargetSubtitleFile(files, preferredLang, videoLang);
    if (!targetFile) return null;

    const raw = JSON.parse(fs.readFileSync(path.join(outputDir, targetFile), 'utf-8'));
    const words = [];

    for (const ev of raw.events || []) {
      const baseStart = (ev.tStartMs || 0) / 1000;
      for (const seg of ev.segs || []) {
        const text = (seg.utf8 || '').trim();
        if (!text || text === '\n') continue;
        const offset = (seg.tOffsetMs || 0) / 1000;
        const start = parseFloat((baseStart + offset).toFixed(3));
        const duration = (seg.dDurationMs || 300) / 1000;
        const end = parseFloat((start + duration).toFixed(3));
        words.push({ word: text, start, end });
      }
    }

    // Extract raw language tag from filename: jobId_sub.<tag>.json3
    const match = targetFile.match(/_sub\.([^.]+)\.json3$/);
    const rawTag = match ? match[1] : '';
    let isoLang = normalizeLanguageCode(rawTag);

    // Cross-verify dengan deteksi stopword teks transkrip
    const sampleText = words.slice(0, 150).map(w => w.word).join(' ');
    const textLang = detectLanguageFromText(sampleText, videoLang || 'id');

    if (!isoLang || isoLang === 'unknown' || isoLang === 'auto') {
      isoLang = textLang;
    } else if (isoLang !== textLang && words.length >= 20) {
      if (textLang === videoLang || !targetFile.includes('-orig.')) {
        isoLang = textLang;
      }
    }

    for (const f of files) {
      try { fs.unlinkSync(path.join(outputDir, f)); } catch (_) {}
    }

    if (words.length >= 10) {
      console.log(`⚡ Berhasil mengambil transkrip instan (${words.length} kata, bahasa: ${isoLang.toUpperCase()})`);
      return { words, language: isoLang };
    }
  } catch (err) {
    console.warn(`⚠️ Gagal memproses transkrip YouTube, fallback: ${err.message}`);
  } finally {
    try {
      const remainingFiles = fs.readdirSync(outputDir).filter(f => f.startsWith(`${jobId}_sub.`) && f.endsWith('.json3'));
      for (const f of remainingFiles) {
        try { fs.unlinkSync(path.join(outputDir, f)); } catch (_) {}
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Download HANYA potongan/section video tertentu (misal detik 60 s/d 105).
 * Sangat hemat kuota & cepat (hanya unduh ~10-20MB per klip).
 *
 * @param {string} rawUrl - YouTube URL
 * @param {number} start - Detik mulai
 * @param {number} end - Detik selesai
 * @param {string} outputPath - File output .mp4
 */
export async function downloadClipSection(rawUrl, start, end, outputPath) {
  const url = requireSafeUrl(rawUrl);
  const startTime = formatSectionTimestamp(start);
  const endTime = formatSectionTimestamp(end);
  const sectionSpec = `*${startTime}-${endTime}`;

  console.log(`📥 Downloading video section only [${sectionSpec}]: ${url}`);
  // Prefer Full HD 1080p for crisp, sharp 9:16 vertical cropping (yields 608px width instead of blurry 405px)
  const formatChain = 'bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=1080]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';

  const sectionStrategies = [
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '--extractor-args', 'youtube:player_client=web,default',
      '--download-sections', sectionSpec,
      '-f', formatChain, '--merge-output-format', 'mp4',
      '-o', outputPath, '--force-keyframes-at-cuts', '--', url,
    ],
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '--download-sections', sectionSpec,
      '-f', formatChain, '--merge-output-format', 'mp4',
      '-o', outputPath, '--force-keyframes-at-cuts', '--', url,
    ],
    [
      ...YTDLP_BASE_ARGS, '--retries', '3', '--fragment-retries', '3',
      '--extractor-args', 'youtube:player_client=android,web',
      '--download-sections', sectionSpec,
      '-f', 'best[height<=1080]/best[height<=720]/best', '--merge-output-format', 'mp4',
      '-o', outputPath, '--force-keyframes-at-cuts', '--', url,
    ],
  ];

  let success = false;
  let lastErr = null;

  for (let i = 0; i < sectionStrategies.length; i++) {
    const args = sectionStrategies[i];
    try {
      if (i > 0) {
        console.log(`🔄 Retrying section download with fallback strategy #${i + 1}...`);
      }
      await execFileAsync(YTDLP_BIN, args, { timeout: 180000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        success = true;
        break;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ Section download strategy #${i + 1} notice: ${err.message.substring(0, 100)}...`);
    }
  }

  if (!success) {
    throw new Error(`Gagal mengunduh bagian video (${sectionSpec}): ${lastErr ? lastErr.message : 'Unknown error'}`);
  }

  return outputPath;
}

/**
 * Download video YouTube menggunakan yt-dlp (Legacy fallback)
 */
export async function downloadVideo(url, jobId, options = {}) {
  const outputDir = path.resolve(UPLOAD_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioOutput = path.join(outputDir, `${jobId}_audio.mp3`);

  // Download audio & info (atau hanya info jika skipAudioDownload aktif)
  const info = await downloadAudioAndInfo(url, jobId, options);

  return {
    videoPath: url, // simpan URL agar clipper bisa download per section
    audioPath: info.audioPath,
    title: info.title,
    duration: info.duration,
    subtitles: info.subtitles,
    channelName: info.channelName || null,
    language: info.language,
  };
}

/**
 * Hapus file temporary setelah selesai
 */
export function cleanupFiles(...filePaths) {
  for (const filePath of filePaths) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  }
}
