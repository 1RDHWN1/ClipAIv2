// utils/clipper.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import 'dotenv/config';
import { buildAudioCrossfadeFilter } from './boundarySnapper.js';
import { downloadClipSection } from './downloader.js';
import { generateAssSubtitles, escapeAssPath } from './subtitleGenerator.js';
import { buildBrandingFilters, appendBrandingToGraph, appendBrandingToVideoFilters, normalizeBrandingConfig } from './brandingOverlay.js';
import { getHardwareAccelerationConfig } from './gpuDetector.js';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './outputs';
const SPEAKER_TRACKING_ENABLED = process.env.SPEAKER_TRACKING_ENABLED !== 'false';
const SPEAKER_SWITCH_MIN_SECONDS = parseFloat(process.env.SPEAKER_SWITCH_MIN_SECONDS || '2.4');
const SPEAKER_POSITION_PADDING_RATIO = parseFloat(process.env.SPEAKER_POSITION_PADDING_RATIO || '0.14');
const FACE_TRACKING_ENABLED = process.env.FACE_TRACKING_ENABLED !== 'false';
const FACE_TRACKING_PYTHON = process.env.FACE_TRACKING_PYTHON || 'python';
const FACE_TRACKING_SAFE_MARGIN_RATIO = parseFloat(process.env.FACE_TRACKING_SAFE_MARGIN_RATIO || '0.18');

// ── Encoding (audit finding H1) ─────────────────────────────────────────────
// Previously the command carried BOTH `-b:v 2000k` and `-crf 23`, with the
// `-crf` placed AFTER `-preset`. In x264 a CRF target overrides the bitrate
// target, so the effective quality was CRF 23 — blocky for a 1080x1920 canvas
// where burned-in subtitles and grain are visible — while `-b:v` did nothing.
// The two modes are now explicitly separated: CRF (quality) unless
// VIDEO_ENCODING_MODE=bitrate is set, in which case only bitrate flags apply.
const VIDEO_ENCODING_MODE = (process.env.VIDEO_ENCODING_MODE || 'crf').toLowerCase();
const VIDEO_CRF = parseInt(process.env.VIDEO_CRF || '19', 10);
const VIDEO_PRESET = process.env.VIDEO_PRESET || 'medium';
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '8000k';
const VIDEO_MAXRATE = process.env.VIDEO_MAXRATE || '10000k';
const VIDEO_BUFSIZE = process.env.VIDEO_BUFSIZE || '12000k';

// ---------------------------------------------------------------------------
// FFmpeg expression limits (audit finding H2)
//
// The `overlay ... enable=` expression is evaluated by FFmpeg's expression
// parser. Empirically, this build handles up to 100 `between(t,a,b)` terms and
// then dies with:
//
//   [overlay] Error when evaluating the expression '...' for enable
//   [AVFilterGraph] Error initializing filters
//   Error : Cannot allocate memory
//
// Verified by real render against a 1920x1080 testsrc2 clip:
//   99 terms  -> exit 0
//   100 terms -> exit 0
//   101 terms -> exit 244 (filter graph fails to initialize)
//
// Without a guard the whole clip silently falls back to a plain center crop
// (see clipVideo's catch), so the user loses split-screen with no error shown.
// We cap well below the cliff and merge excess intervals down to the cap.
// ---------------------------------------------------------------------------
const MAX_OVERLAY_ENABLE_TERMS = parseInt(process.env.MAX_OVERLAY_ENABLE_TERMS || '80', 10);

/**
 * Collapse an interval list to at most `maxTerms` entries.
 *
 * Adjacent/nearby intervals are joined (their union, averaged anchor) so that a
 * genuinely long wide-shot region still produces split-screen instead of being
 * dropped. Intervals that are far apart are merged only as a last resort, and
 * always merges the *closest pair* first to lose the least precision.
 *
 * @param {Array<{start:number,end:number,x1?:number,x2?:number}>} intervals
 * @param {number} maxTerms
 * @returns {Array<{start:number,end:number,x1?:number,x2?:number}>}
 */
export function capWideIntervals(intervals, maxTerms = MAX_OVERLAY_ENABLE_TERMS) {
  if (!Array.isArray(intervals) || intervals.length <= maxTerms) return intervals;

  // Work on a sorted copy so "closest pair" means closest in time.
  const sorted = intervals
    .map((i) => ({ start: Number(i.start), end: Number(i.end), x1: Number(i.x1), x2: Number(i.x2) }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end))
    .sort((a, b) => a.start - b.start);

  while (sorted.length > maxTerms) {
    // Find the adjacent pair with the smallest gap; merge it.
    let bestIdx = 0;
    let bestGap = Infinity;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].start - sorted[i].end;
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }

    const a = sorted[bestIdx];
    const b = sorted[bestIdx + 1];
    const mergedStart = Math.min(a.start, b.start);
    const mergedEnd = Math.max(a.end, b.end);
    const wA = Math.max(1e-6, a.end - a.start);
    const wB = Math.max(1e-6, b.end - b.start);

    sorted.splice(bestIdx, 2, {
      start: mergedStart,
      end: mergedEnd,
      x1: Math.round((a.x1 * wA + b.x1 * wB) / (wA + wB)),
      x2: Math.round((a.x2 * wA + b.x2 * wB) / (wA + wB)),
    });
  }

  return sorted;
}

/**
 * Builds dynamic adaptive filter graph:
 * Uses Solo Face-Tracked crop for single-person shots, and
 * overlays Stacked Split-Screen ONLY during wide shots with 2 people!
 */
export function buildAdaptiveSplitFilterGraph({
  srcWidth = 1920,
  srcHeight = 1080,
  soloCropXExpr,
  wideIntervals = [],
  subtitleAssPath,
} = {}) {
  const targetWidth = Math.min(srcWidth, Math.floor(srcHeight * 9 / 16));
  const cropHeight = Math.min(Math.floor(targetWidth * 16 / 9), srcHeight);
  const soloY = Math.max(0, Math.floor((srcHeight - cropHeight) / 2));
  const validXExpr = soloCropXExpr || `${Math.floor((srcWidth - targetWidth) / 2)}`;

  const filterParts = [
    `[0:v]crop=${targetWidth}:${cropHeight}:${validXExpr}:${soloY},scale=1080:1920:flags=lanczos,setsar=1[solo]`,
  ];

  if (Array.isArray(wideIntervals) && wideIntervals.length > 0) {
    // Guard against FFmpeg's ~100-term expression cliff (audit finding H2).
    const safeIntervals = capWideIntervals(wideIntervals);
    if (safeIntervals.length !== wideIntervals.length) {
      console.warn(
        `[clipper] wideIntervals capped: ${wideIntervals.length} -> ${safeIntervals.length} ` +
        `(FFmpeg enable expression limit is ~100 terms)`
      );
    }

    const avgX1 = safeIntervals.reduce((acc, i) => acc + (i.x1 || srcWidth * 0.22), 0) / safeIntervals.length;
    const avgX2 = safeIntervals.reduce((acc, i) => acc + (i.x2 || srcWidth * 0.78), 0) / safeIntervals.length;

    // Each stacked panel renders at 1080x960, i.e. aspect ratio 1.125 (landscape).
    // The crop MUST match that ratio, otherwise FFmpeg stretches the image and
    // subjects end up distorted with heads pushed out of frame.
    const PANEL_OUT_W = 1080;
    const PANEL_OUT_H = 960;
    const panelAspect = PANEL_OUT_W / PANEL_OUT_H; // 1.125

    // Derive panel crop from the OUTPUT aspect, capped by source dimensions.
    // Prefer a crop that is wide enough to include shoulders (speaker width),
    // while preserving the panel aspect ratio exactly.
    let panelCropH = srcHeight;
    let panelCropW = Math.min(srcWidth, Math.round(panelCropH * panelAspect));

    // If the room is too narrow, shrink height instead of distorting width.
    if (panelCropW > srcWidth) {
      panelCropW = srcWidth;
      panelCropH = Math.min(srcHeight, Math.round(panelCropW / panelAspect));
    }

    const cropX1 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(avgX1 - panelCropW / 2)));
    const cropX2 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(avgX2 - panelCropW / 2)));

    // Vertically center the panel on the subject band (faces sit in the upper
    // portion of the frame). Using cropY = 0 clipped heads at the top.
    const FACE_BAND_CENTER_RATIO = 0.42; // faces/keypoints cluster around 42% height
    const desiredY = Math.round((srcHeight * FACE_BAND_CENTER_RATIO) - (panelCropH / 2));
    const cropY = Math.max(0, Math.min(srcHeight - panelCropH, desiredY));

    const evenX1 = Math.floor(cropX1 / 2) * 2;
    const evenX2 = Math.floor(cropX2 / 2) * 2;
    const evenY = Math.floor(cropY / 2) * 2;

    filterParts.push(`[0:v]crop=${panelCropW}:${panelCropH}:${evenX1}:${evenY},scale=${PANEL_OUT_W}:${PANEL_OUT_H}:flags=lanczos,setsar=1[top]`);
    filterParts.push(`[0:v]crop=${panelCropW}:${panelCropH}:${evenX2}:${evenY},scale=${PANEL_OUT_W}:${PANEL_OUT_H}:flags=lanczos,setsar=1[bottom]`);
    filterParts.push(`[top][bottom]vstack=inputs=2[split]`);

    const enableExpr = safeIntervals
      .map((intv) => `between(t\\,${Number(intv.start).toFixed(2)}\\,${Number(intv.end).toFixed(2)})`)
      .join('+');

    filterParts.push(`[solo][split]overlay=0:0:enable='${enableExpr}'[vraw]`);
  } else {
    filterParts[0] = `[0:v]crop=${targetWidth}:${cropHeight}:${validXExpr}:${soloY},scale=1080:1920:flags=lanczos,setsar=1[vraw]`;
  }

  let outputMap = '[vraw]';
  if (subtitleAssPath) {
    const escapedAss = escapeAssPath(subtitleAssPath);
    filterParts.push(`[vraw]ass='${escapedAss}'[vout]`);
    outputMap = '[vout]';
  }

  return {
    filterComplex: filterParts.join(';'),
    outputMap,
    renderWidth: 1080,
    renderHeight: 1920,
  };
}

/**
 * Builds stacked gaming streamer filter graph:
 * Top panel: Facecam zoom (1080x800)
 * Bottom panel: Full 16:9 gameplay fitted (1080x1120)
 * Total: 1080x1920 (9:16)
 */
export function buildGamingStreamerFilterGraph({
  srcWidth = 1920,
  srcHeight = 1080,
  camX,
  camY,
  camW,
  camH,
  subtitleAssPath,
} = {}) {
  const defaultCamW = Math.min(srcWidth, Math.floor(srcWidth * 0.35));
  const defaultCamH = Math.min(srcHeight, Math.floor(srcHeight * 0.45));

  const targetCamW = camW || defaultCamW;
  const targetCamH = camH || defaultCamH;

  const defaultCamX = srcWidth - targetCamW;
  const defaultCamY = srcHeight - targetCamH;

  const targetCamX = typeof camX === 'number'
    ? Math.max(0, Math.min(srcWidth - targetCamW, Math.floor(camX)))
    : defaultCamX;
  const targetCamY = typeof camY === 'number'
    ? Math.max(0, Math.min(srcHeight - targetCamH, Math.floor(camY)))
    : defaultCamY;

  const filterParts = [
    `[0:v]crop=${targetCamW}:${targetCamH}:${targetCamX}:${targetCamY},scale=1080:800:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:800,setsar=1[cam]`,
    `[0:v]scale=1080:1120:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1120:(ow-iw)/2:(oh-ih)/2:black,setsar=1[game]`,
    `[cam][game]vstack=inputs=2[vraw]`,
  ];

  let outputMap = '[vraw]';
  if (subtitleAssPath) {
    const escapedAss = escapeAssPath(subtitleAssPath);
    filterParts.push(`[vraw]ass='${escapedAss}'[v]`);
    outputMap = '[v]';
  } else {
    filterParts[2] = `[cam][game]vstack=inputs=2[v]`;
    outputMap = '[v]';
  }

  return {
    filterComplex: filterParts.join(';'),
    outputMap,
    renderWidth: 1080,
    renderHeight: 1920,
    camHeight: 800,
    gameHeight: 1120,
  };
}

/**
 * Build the video encoding options for libx264 as an explicit, testable list.
 *
 * Audit finding H1: mixing `-b:v` with `-crf` silently makes `-crf` win, so the
 * bitrate was decorative and quality landed at whatever CRF was hardcoded. This
 * function emits exactly ONE rate-control mode so the intent is unambiguous.
 *
 * @param {Object} [overrides]
 * @returns {string[]} output options to hand to ffmpeg
 */
export function buildVideoEncodingOptions(overrides = {}) {
  if (overrides.hwaccel === true || overrides.encoder === 'h264_vaapi') {
    const qp = overrides.qp !== undefined ? String(overrides.qp) : '18';
    return [
      '-c:v', 'h264_vaapi',
      '-rc_mode', 'CQP',
      '-qp', qp,
      '-profile:v', 'high',
      '-coder', 'cabac',
      '-movflags', '+faststart',
    ];
  }

  const mode = (overrides.mode || VIDEO_ENCODING_MODE).toLowerCase();
  const preset = overrides.preset || VIDEO_PRESET;

  const qualityFlags = mode === 'bitrate'
    ? [
        '-b:v', overrides.bitrate || VIDEO_BITRATE,
        '-maxrate', overrides.maxrate || VIDEO_MAXRATE,
        '-bufsize', overrides.bufsize || VIDEO_BUFSIZE,
      ]
    : ['-crf', String(overrides.crf ?? VIDEO_CRF)];

  // NOTE: no `-b:v` in CRF mode and no `-crf` in bitrate mode — that mutual
  // exclusivity is the entire point of this helper.
  return [
    ...qualityFlags,
    '-preset', preset,
    '-movflags', '+faststart', // streaming-friendly
    '-pix_fmt', 'yuv420p',
  ];
}

/**
 * Potong video berdasarkan timestamp dan reframe ke aspect ratio yang diinginkan
 * @param {string} videoPath - Path source video
 * @param {Array} clips - Array clip dari AI analyzer [{start, end, title, ...}]
 * @param {string} jobId - ID job
 * @param {string} aspectRatio - '9:16' | '1:1' | '16:9'
 * @param {{ speakerTurns?: Array }} options
 * @returns {Promise<Array<{clipPath, title, ...}>>}
 */
export async function processClips(videoPath, clips, jobIdOrOptions, aspectRatioParam = '9:16', optionsParam = {}) {
  const isOptionsObj = typeof jobIdOrOptions === 'object' && jobIdOrOptions !== null && !Array.isArray(jobIdOrOptions);
  const jobId = isOptionsObj ? (jobIdOrOptions.jobId || 'job') : (typeof jobIdOrOptions === 'string' ? jobIdOrOptions : 'job');
  const aspectRatio = isOptionsObj ? (jobIdOrOptions.aspectRatio || '9:16') : aspectRatioParam;
  const options = isOptionsObj ? { ...jobIdOrOptions, ...optionsParam } : optionsParam;

  // `options.outputDir` lets tests render into a temp dir instead of polluting
  // the real outputs/ folder.
  const outputDir = path.resolve(options.outputDir || OUTPUT_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Dapatkan info video asli.
  //
  // Audit M1: `videoPath` is normally the YouTube URL (the worker hands the URL
  // to the clipper so each clip is fetched on demand). getVideoInfo() returns
  // null for a URL rather than a fabricated 1280x720, so the real geometry is
  // resolved per clip from the downloaded section. `srcWidth`/`srcHeight` only
  // serve as a pre-download placeholder (e.g. for logging) and MUST NOT be
  // trusted for crop maths.
  const videoInfo = await getVideoInfo(videoPath);
  const srcWidth = videoInfo?.width || 0;
  const srcHeight = videoInfo?.height || 0;
  const speakerTurns = Array.isArray(options.speakerTurns) ? options.speakerTurns : [];
  const speakerOrder = getSpeakerOrder(speakerTurns);

  if (srcWidth > 0 && srcHeight > 0) {
    console.log(`📐 Source video: ${srcWidth}x${srcHeight}, AR: ${aspectRatio}`);
  } else {
    console.log(`📐 Source: belum diketahui (URL) — dimensi dibaca dari section per clip, AR: ${aspectRatio}`);
  }

  const hwConfig = getHardwareAccelerationConfig(options);
  if (hwConfig.enabled) {
    console.log(`⚡ Hardware Acceleration: ${hwConfig.name} (Active)`);
  } else {
    console.log(`🖥️ Video Encoding: CPU Software (libx264)`);
  }

  const results = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const safeTitle = clip.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, '').trim().replace(/\s+/g, '_');
    const outputFilename = `${jobId}_clip${i + 1}_${safeTitle}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    console.log(`\n✂️  Processing clip ${i + 1}/${clips.length}: ${clip.start}s - ${clip.end}s`);

    let sourceForProcessing = videoPath;
    let clipForProcessing = clip;
    let tempSectionFile = null;
    let tempAssFile = null;

    try {
      if (typeof videoPath === 'string' && (videoPath.startsWith('http://') || videoPath.startsWith('https://'))) {
        tempSectionFile = path.join(outputDir, `${jobId}_temp_sec_${i + 1}.mp4`);
        await downloadClipSection(videoPath, clip.start, clip.end, tempSectionFile);
        sourceForProcessing = tempSectionFile;
        const duration = Math.max(0.1, clip.end - clip.start);
        clipForProcessing = { ...clip, start: 0, end: duration };
      }

      // Resolve the REAL geometry for this clip.
      //
      // Audit M1: crop maths depends entirely on these values, and they must come
      // from the actual media. When the source is a URL we download the section
      // first and probe that file. If we still cannot determine the dimensions we
      // fail the clip explicitly — rendering with a guessed resolution produces a
      // permanently mis-cropped video that looks "successful".
      let currentWidth = srcWidth;
      let currentHeight = srcHeight;

      if (tempSectionFile) {
        try {
          const secInfo = await getVideoInfo(tempSectionFile);
          if (secInfo && secInfo.width > 0 && secInfo.height > 0) {
            currentWidth = secInfo.width;
            currentHeight = secInfo.height;
          }
        } catch (err) {
          console.warn(`⚠️ [clipper] ffprobe section gagal: ${err.message}`);
        }
      }

      if (!(currentWidth > 0 && currentHeight > 0)) {
        throw new Error(
          'Dimensi sumber tidak dapat ditentukan untuk crop (width/height tidak valid). ' +
          'Render dibatalkan agar tidak menghasilkan crop yang salah.'
        );
      }

      // Check if subtitles enabled and words available
      const subtitleConfig = options.subtitleConfig;
      if (subtitleConfig?.enabled) {
        const candidateWords = (Array.isArray(clip.words) && clip.words.length > 0)
          ? clip.words
          : (Array.isArray(options.words) ? options.words : []);

        // Selalu asumsikan input words pakai absolute timestamp (dari awal video).
        // Konversi ke relative timestamp untuk subtitle generator.
        const clipWords = candidateWords
          .filter(w => w && typeof w.word === 'string' && w.end > clip.start && w.start < clip.end)
          .map(w => ({ ...w, start: w.start - clip.start, end: w.end - clip.start }))
          .filter(w => w.end > w.start)
          .sort((a, b) => a.start - b.start);

        if (clipWords.length > 0) {
          const assContent = generateAssSubtitles(
            clipWords,
            0,  // relative start (sudah dikonversi di atas)
            clip.end - clip.start,  // relative duration
            {
              ...subtitleConfig,
              marginV: subtitleConfig.marginV !== undefined ? Number(subtitleConfig.marginV) : 160,
            }
          );

          if (assContent && assContent.includes('Dialogue:')) {
            const assFilename = `${jobId || 'clip'}_subs_${i + 1}.ass`;
            tempAssFile = path.join(outputDir, assFilename);
            fs.writeFileSync(tempAssFile, assContent, 'utf-8');
            console.log(`   📝 Subtitles generated: ${assFilename} (${clipWords.length} words)`);
          }
        }
      }

      const trackingResult = await getFaceTrackingPlan({
        videoPath: sourceForProcessing,
        clip: clipForProcessing,
        speakerTurns,
        aspectRatio,
      });

      const faceTrackingPlan = Array.isArray(trackingResult) ? trackingResult : (trackingResult?.plan || []);
      const wideIntervals = Array.isArray(trackingResult?.wideIntervals) ? trackingResult.wideIntervals : [];
      const webcamBox = trackingResult?.webcamBox || null;

      let effectiveLayoutMode = options.layoutMode || 'standard';
      if (effectiveLayoutMode === 'auto_split') {
        if (webcamBox && (webcamBox.score || 0) >= 4.0) {
          console.log(`   🎮 Smart Adaptive detected persistent gaming webcam overlay (${webcamBox.quadrant}, score ${webcamBox.score}) -> transitioning to gaming_streamer layout`);
          effectiveLayoutMode = 'gaming_streamer';
        }
      }

      await clipVideo(sourceForProcessing, outputPath, clipForProcessing, currentWidth, currentHeight, aspectRatio, {
        speakerTurns,
        speakerOrder,
        faceTrackingPlan,
        wideIntervals,
        webcamBox,
        subtitleAssPath: tempAssFile,
        layoutMode: effectiveLayoutMode,
        // Diteruskan eksplisit: opsi ini di-whitelist manual, jadi field yang
        // lupa didaftarkan di sini akan hilang tanpa error apa pun — persis
        // yang dulu terjadi pada branding (render sukses tapi tanpa overlay).
        branding: options.branding || null,
        encodingOverrides: options.encodingOverrides,
        hwaccel: options.hwaccel,
      });
    } finally {
      if (tempSectionFile && fs.existsSync(tempSectionFile)) {
        try { fs.unlinkSync(tempSectionFile); } catch (_) {}
      }
      if (tempAssFile && fs.existsSync(tempAssFile)) {
        try { fs.unlinkSync(tempAssFile); } catch (_) {}
      }
    }

    const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    const res = {
      ...clip,
      clipIndex: i + 1,
      filename: outputFilename,
      outputPath,
      fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
      duration: Math.round(clip.end - clip.start),
    };

    console.log(`   ✅ Clip ${i + 1} done: ${outputFilename} (${res.fileSizeMB}MB)`);
    results.push(res);
  }

  return results;
}

/**
 * Proses satu clip dengan FFmpeg (dilengkapi fallback otomatis jika filter kompleks gagal)
 */
async function clipVideo(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, options = {}) {
  try {
    await executeFfmpegClip(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, options);
  } catch (err) {
    // Jika FFmpeg gagal saat menggunakan filter face-tracking, fallback otomatis ke center crop
    if (options.faceTrackingPlan && options.faceTrackingPlan.length > 0) {
      console.warn(`⚠️ [clipper] FFmpeg gagal pada filter face-tracking (${err.message}). Merender ulang dengan center crop stabil...`);
      await executeFfmpegClip(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, {
        ...options,
        faceTrackingPlan: [],
      });
    } else {
      throw err;
    }
  }
}

function executeFfmpegClip(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, options = {}) {
  return new Promise((resolve, reject) => {
    const duration = clip.end - clip.start;
    let afFilter = null;
    if (duration > 0) {
      try {
        afFilter = buildAudioCrossfadeFilter(duration);
      } catch (err) {
        console.warn(`[clipper] Audio crossfade filter skipped: ${err.message}`);
      }
    }

    const hwConfig = options._retryCpu
      ? { enabled: false }
      : getHardwareAccelerationConfig(options);
    const useGpu = hwConfig.enabled;

    if (useGpu && hwConfig.driver) {
      process.env.LIBVA_DRIVER_NAME = hwConfig.driver;
    }

    let cmd = ffmpeg(inputPath)
      .seekInput(clip.start)
      .duration(duration);

    if (useGpu) {
      cmd = cmd
        .inputOptions(['-vaapi_device', hwConfig.device])
        .outputOptions(buildVideoEncodingOptions({ hwaccel: true, qp: 18 }));
    } else {
      cmd = cmd
        .videoCodec('libx264')
        .outputOptions(buildVideoEncodingOptions(options.encodingOverrides));
    }

    cmd = cmd.audioCodec('aac')
             .audioBitrate('128k');

    const layoutMode = options.layoutMode || 'standard';

    // Branding (atribusi sumber + watermark channel) digambar PALING AKHIR,
    // setelah layout & subtitle, supaya tidak ikut ter-crop atau tertutup sub.
    const brandingCfg = options.branding && typeof options.branding === 'object'
      ? normalizeBrandingConfig(options.branding)
      : null;

    if (layoutMode === 'gaming_streamer' && aspectRatio === '9:16') {
      const graph = buildGamingStreamerFilterGraph({
        srcWidth,
        srcHeight,
        camX: options.webcamBox?.x,
        camY: options.webcamBox?.y,
        camW: options.webcamBox?.width,
        camH: options.webcamBox?.height,
        subtitleAssPath: options.subtitleAssPath,
      });
      let filterComplex = graph.filterComplex;
      let outputMap = graph.outputMap;
      if (brandingCfg) {
        ({ filterComplex, outputLabel: outputMap } = appendBrandingToGraph(filterComplex, outputMap, brandingCfg));
      }
      if (useGpu) {
        filterComplex += `;${outputMap}format=nv12,hwupload[hwout]`;
        outputMap = '[hwout]';
      }
      cmd = cmd.complexFilter(filterComplex, outputMap)
               .outputOptions(['-map 0:a?']);
    } else if (layoutMode === 'auto_split' && aspectRatio === '9:16') {
      const defaultX = Math.floor((srcWidth - Math.min(srcWidth, Math.floor(srcHeight * 9 / 16))) / 2);
      const soloXExpr = buildSpeakerAwareCropX({
        srcWidth,
        cropWidth: Math.min(srcWidth, Math.floor(srcHeight * 9 / 16)),
        clip,
        speakerTurns: options.speakerTurns || [],
        speakerOrder: options.speakerOrder || [],
        defaultX,
        faceTrackingPlan: options.faceTrackingPlan || [],
      });
      const graph = buildAdaptiveSplitFilterGraph({
        srcWidth,
        srcHeight,
        soloCropXExpr: soloXExpr,
        wideIntervals: options.wideIntervals || [],
        subtitleAssPath: options.subtitleAssPath,
      });
      let filterComplex = graph.filterComplex;
      let outputMap = graph.outputMap;
      if (brandingCfg) {
        ({ filterComplex, outputLabel: outputMap } = appendBrandingToGraph(filterComplex, outputMap, brandingCfg));
      }
      if (useGpu) {
        filterComplex += `;${outputMap}format=nv12,hwupload[hwout]`;
        outputMap = '[hwout]';
      }
      cmd = cmd.complexFilter(filterComplex, outputMap)
               .outputOptions(['-map 0:a?']);
    } else if (layoutMode === 'split_screen' && aspectRatio === '9:16') {
      let graph = buildStackedSplitFilterGraph({
        srcWidth,
        srcHeight,
      });
      let filterComplex = graph.filterComplex;
      let outMap = graph.outputMap;
      if (options.subtitleAssPath) {
        const escapedAss = escapeAssPath(options.subtitleAssPath);
        filterComplex += `;${graph.outputMap}ass='${escapedAss}'[vout]`;
        outMap = '[vout]';
      }
      if (brandingCfg) {
        ({ filterComplex, outputLabel: outMap } = appendBrandingToGraph(filterComplex, outMap, brandingCfg));
      }
      if (useGpu) {
        filterComplex += `;${outMap}format=nv12,hwupload[hwout]`;
        outMap = '[hwout]';
      }
      cmd = cmd.complexFilter(filterComplex, outMap)
               .outputOptions(['-map 0:a?']);
    } else {
      let vfFilter = buildVideoFilter({
        srcWidth,
        srcHeight,
        aspectRatio,
        clip,
        speakerTurns: options.speakerTurns || [],
        speakerOrder: options.speakerOrder || [],
        faceTrackingPlan: options.faceTrackingPlan || [],
        subtitleAssPath: options.subtitleAssPath,
      });
      if (brandingCfg) {
        vfFilter = appendBrandingToVideoFilters(vfFilter, brandingCfg);
      }
      if (useGpu) {
        vfFilter = vfFilter ? `${vfFilter},format=nv12,hwupload` : 'format=nv12,hwupload';
      }
      if (vfFilter) {
        cmd = cmd.videoFilters(vfFilter);
      }
    }

    if (afFilter) {
      cmd = cmd.audioFilters(afFilter);
    }

    cmd
      .output(outputPath)
      .on('start', (cmdLine) => {
        console.log(`   FFmpeg: ${cmdLine.substring(0, 100)}...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`   Progress: ${Math.round(progress.percent)}%\r`);
        }
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve();
      })
      .on('error', async (err) => {
        if (useGpu && !options._retryCpu) {
          console.warn(`⚠️ [clipper] GPU VAAPI encoding failed: ${err.message}. Retrying on CPU fallback...`);
          try {
            await executeFfmpegClip(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, {
              ...options,
              hwaccel: 'cpu',
              _retryCpu: true,
            });
            return resolve();
          } catch (cpuErr) {
            return reject(cpuErr);
          }
        }
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .run();
  });
}

/**
 * Buat video filter untuk reframe aspect ratio
 */
function buildVideoFilter({ srcWidth, srcHeight, aspectRatio, clip, speakerTurns, speakerOrder, faceTrackingPlan, subtitleAssPath }) {
  const filters = [];

  if (aspectRatio === '9:16') {
    const targetWidth = Math.min(srcWidth, Math.floor(srcHeight * 9 / 16));
    const cropHeight = Math.min(Math.floor(targetWidth * 16 / 9), srcHeight);
    const defaultX = Math.floor((srcWidth - targetWidth) / 2);
    const y = Math.max(0, Math.floor((srcHeight - cropHeight) / 2));
    const xExpr = buildSpeakerAwareCropX({
      srcWidth,
      cropWidth: targetWidth,
      clip,
      speakerTurns,
      speakerOrder,
      defaultX,
      faceTrackingPlan,
    });
    filters.push(`crop=${targetWidth}:${cropHeight}:${xExpr}:${y}`);
    filters.push(`scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos`);
    filters.push(`pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`);
  } else if (aspectRatio === '1:1') {
    const size = Math.min(srcWidth, srcHeight);
    const defaultX = Math.floor((srcWidth - size) / 2);
    const y = Math.floor((srcHeight - size) / 2);
    const xExpr = buildSpeakerAwareCropX({
      srcWidth,
      cropWidth: size,
      clip,
      speakerTurns,
      speakerOrder,
      defaultX,
      faceTrackingPlan,
    });
    filters.push(`crop=${size}:${size}:${xExpr}:${y}`);
    filters.push(`scale=1080:1080:flags=lanczos`);
  } else {
    filters.push(`scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos`);
    filters.push(`pad=1280:720:(ow-iw)/2:(oh-ih)/2:black`);
  }

  if (subtitleAssPath) {
    const escapedAssPath = escapeAssPath(subtitleAssPath);
    filters.push(`ass='${escapedAssPath}'`);
  }

  return filters.join(',');
}

function buildSpeakerAwareCropX({ srcWidth, cropWidth, clip, speakerTurns, speakerOrder, defaultX, faceTrackingPlan }) {
  const faceTracked = buildFaceTrackedCropX({
    srcWidth,
    cropWidth,
    defaultX,
    faceTrackingPlan,
  });
  if (faceTracked) {
    return faceTracked;
  }

  if (!SPEAKER_TRACKING_ENABLED || cropWidth >= srcWidth || !Array.isArray(speakerTurns) || speakerTurns.length === 0) {
    return `${defaultX}`;
  }

  const focusPlan = buildSpeakerFocusPlan(clip, speakerTurns);
  if (focusPlan.length === 0) {
    return `${defaultX}`;
  }

  const anchorMap = buildSpeakerAnchorMap({
    speakerOrder,
    focusPlan,
    srcWidth,
    cropWidth,
    defaultX,
  });

  if (focusPlan.length === 1) {
    return `${anchorMap.get(focusPlan[0].speaker) ?? defaultX}`;
  }

  return buildTimedCropExpression(focusPlan, anchorMap, defaultX);
}

function buildFaceTrackedCropX({ srcWidth, cropWidth, defaultX, faceTrackingPlan }) {
  if (!FACE_TRACKING_ENABLED || cropWidth >= srcWidth || !Array.isArray(faceTrackingPlan) || faceTrackingPlan.length === 0) {
    return null;
  }

  const maxX = Math.max(0, srcWidth - cropWidth);
  const normalizedPlan = faceTrackingPlan
    .map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      is_cut: Boolean(segment.is_cut),
      x: calculateSafeFaceCropX({
        centerX: Number(segment.center_x),
        faceWidth: Number(segment.face_width || 0),
        cropWidth,
        maxX,
      }),
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && Number.isFinite(segment.x))
    .sort((a, b) => a.start - b.start);

  if (normalizedPlan.length === 0) {
    return null;
  }

  // 1. Gabungkan segmen berdekatan yang koordinat X-nya mirip (|x1 - x2| < 30px) jika bukan scene cut
  const merged = [];
  for (const seg of normalizedPlan) {
    const prev = merged[merged.length - 1];
    if (prev && !seg.is_cut && Math.abs(prev.x - seg.x) < 30) {
      prev.end = Math.max(prev.end, seg.end);
      prev.x = Math.round((prev.x + seg.x) / 2);
    } else {
      merged.push({ ...seg });
    }
  }

  // 2. Haluskan segmen jitter sangat pendek (< 0.5 detik) jika bukan scene cut
  const smoothed = [];
  for (const seg of merged) {
    const prev = smoothed[smoothed.length - 1];
    if (prev && !seg.is_cut && (seg.end - seg.start) < 0.5) {
      prev.end = Math.max(prev.end, seg.end);
    } else {
      smoothed.push({ ...seg });
    }
  }

  // 3. Batasi segmen (maksimal 22) agar aman di bawah batas kedalaman ekspresi FFmpeg (< 3000 chars)
  const MAX_EXPR_SEGMENTS = 22;
  while (smoothed.length > MAX_EXPR_SEGMENTS) {
    let minDiff = Infinity;
    let mergeIdx = 0;
    for (let i = 0; i < smoothed.length - 1; i++) {
      const diff = Math.abs(smoothed[i].x - smoothed[i + 1].x);
      if (diff < minDiff) {
        minDiff = diff;
        mergeIdx = i;
      }
    }
    const dur1 = smoothed[mergeIdx].end - smoothed[mergeIdx].start;
    const dur2 = smoothed[mergeIdx + 1].end - smoothed[mergeIdx + 1].start;
    smoothed[mergeIdx].end = smoothed[mergeIdx + 1].end;
    smoothed[mergeIdx].x = dur1 >= dur2 ? smoothed[mergeIdx].x : smoothed[mergeIdx + 1].x;
    smoothed.splice(mergeIdx + 1, 1);
  }

  if (smoothed.length === 1) {
    return `${smoothed[0].x}`;
  }

  // Smooth pan animation with EASING_DURATION = 0.50 (500ms) with anticipatory timing
  const EASING_DURATION = 0.50;
  let expression = `${smoothed[smoothed.length - 1].x}`;

  for (let i = smoothed.length - 2; i >= 0; i--) {
    const current = smoothed[i];
    const next = smoothed[i + 1];
    const currentX = current.x;
    const nextX = next.x;

    if (currentX === nextX || next.is_cut) {
      // Hard cut tanpa delay saat pergantian kamera (scene cut) atau bila posisi sama
      expression = `if(lt(t\\,${formatExprNumber(current.end)})\\,${currentX}\\,${expression})`;
    } else {
      // Panning halus antisipatif: mulai bergerak 250ms sebelum waktu bicara agar tiba tepat waktu
      const halfEase = EASING_DURATION / 2;
      const tStart = Math.max(0, current.end - halfEase);
      const tEnd = current.end + halfEase;
      const easingPart = buildFFmpegEasingCropX(currentX, nextX, tStart, tEnd);
      expression = `if(lt(t\\,${formatExprNumber(tStart)})\\,${currentX}\\,if(lt(t\\,${formatExprNumber(tEnd)})\\,${easingPart}\\,${expression}))`;
    }
  }

  return expression;
}

function calculateSafeFaceCropX({ centerX, faceWidth, cropWidth, maxX }) {
  if (!Number.isFinite(centerX)) {
    return 0;
  }

  // Precisely centers the face horizontally in the crop frame
  const cropX = Math.round(centerX - (cropWidth / 2));
  return clamp(cropX, 0, maxX);
}

function buildSpeakerFocusPlan(clip, speakerTurns) {
  const clipDuration = Math.max(0.1, clip.end - clip.start);
  const overlappingTurns = speakerTurns
    .filter((turn) => turn.speaker && turn.end > clip.start && turn.start < clip.end)
    .map((turn) => ({
      speaker: turn.speaker,
      start: Math.max(0, turn.start - clip.start),
      end: Math.min(clipDuration, turn.end - clip.start),
    }))
    .filter((turn) => turn.end - turn.start > 0.15)
    .sort((a, b) => a.start - b.start);

  if (overlappingTurns.length === 0) {
    return [];
  }

  const merged = [];
  for (const turn of overlappingTurns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === turn.speaker && turn.start <= prev.end + 0.35) {
      prev.end = Math.max(prev.end, turn.end);
    } else {
      merged.push({ ...turn });
    }
  }

  const smoothed = [];
  for (const turn of merged) {
    const duration = turn.end - turn.start;
    const prev = smoothed[smoothed.length - 1];

    if (duration < SPEAKER_SWITCH_MIN_SECONDS && prev) {
      prev.end = Math.max(prev.end, turn.end);
      continue;
    }

    smoothed.push({ ...turn });
  }

  for (let i = 0; i < smoothed.length - 1; i++) {
    if (smoothed[i + 1].start > smoothed[i].end) {
      smoothed[i].end = smoothed[i + 1].start;
    }
  }

  smoothed[0].start = 0;
  smoothed[smoothed.length - 1].end = clipDuration;

  return smoothed;
}

function buildSpeakerAnchorMap({ speakerOrder, focusPlan, srcWidth, cropWidth, defaultX }) {
  const focusSpeakers = Array.from(new Set(focusPlan.map((turn) => turn.speaker)));
  const orderedSpeakers = [...speakerOrder];

  for (const speaker of focusSpeakers) {
    if (!orderedSpeakers.includes(speaker)) {
      orderedSpeakers.push(speaker);
    }
  }

  const layoutSpeakers = orderedSpeakers.length > 0 ? orderedSpeakers : focusSpeakers;
  if (layoutSpeakers.length === 0) {
    return new Map();
  }

  const maxX = Math.max(0, srcWidth - cropWidth);
  const center = 0.5;
  let anchorRatios;

  if (layoutSpeakers.length === 1) {
    anchorRatios = [center];
  } else if (layoutSpeakers.length === 2) {
    anchorRatios = [SPEAKER_POSITION_PADDING_RATIO + 0.14, 1 - (SPEAKER_POSITION_PADDING_RATIO + 0.14)];
  } else if (layoutSpeakers.length === 3) {
    anchorRatios = [SPEAKER_POSITION_PADDING_RATIO, center, 1 - SPEAKER_POSITION_PADDING_RATIO];
  } else {
    anchorRatios = layoutSpeakers.map((_, index) => (
      SPEAKER_POSITION_PADDING_RATIO +
      ((1 - (2 * SPEAKER_POSITION_PADDING_RATIO)) * index / Math.max(1, layoutSpeakers.length - 1))
    ));
  }

  const anchorMap = new Map();
  layoutSpeakers.forEach((speaker, index) => {
    const ratio = anchorRatios[index] ?? center;
    const x = clamp(Math.round((srcWidth * ratio) - (cropWidth / 2)), 0, maxX);
    anchorMap.set(speaker, x);
  });

  if (anchorMap.size === 0) {
    anchorMap.set('default', defaultX);
  }

  return anchorMap;
}

/**
 * Evaluates cosine easing for progress p in [0, 1].
 */
export function cosineEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

/**
 * Evaluates smoothstep easing for progress p in [0, 1].
 */
export function smoothstepEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Builds an FFmpeg crop expression string for a smooth camera transition with cosine easing.
 */
export function buildFFmpegEasingCropX(x1, x2, tStart, tEnd) {
  const dur = (tEnd - tStart).toFixed(3);
  const tStartStr = tStart.toFixed(3);
  const tEndStr = tEnd.toFixed(3);
  const dx = (x2 - x1).toFixed(1);

  return `if(lt(t\\,${tStartStr})\\,${x1}\\,if(lt(t\\,${tEndStr})\\,${x1}+(${dx})*(0.5-0.5*cos(3.14159265*(t-${tStartStr})/${dur}))\\,${x2}))`;
}

/**
 * Builds stacked split-screen filter graph for multi-speaker dialogue
 */
export function buildStackedSplitFilterGraph({
  srcWidth = 1920,
  srcHeight = 1080,
  x1,
  x2,
} = {}) {
  const panelCropW = 608;
  const panelCropH = Math.min(srcHeight, 540);

  const posX1 = typeof x1 === 'number'
    ? (x1 <= 1.0 ? Math.floor(x1 * srcWidth) : x1)
    : Math.floor(srcWidth * 0.28);

  const posX2 = typeof x2 === 'number'
    ? (x2 <= 1.0 ? Math.floor(x2 * srcWidth) : x2)
    : Math.floor(srcWidth * 0.72);

  const cropX1 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(posX1 - panelCropW / 2)));
  const cropX2 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(posX2 - panelCropW / 2)));
  const cropY = Math.max(0, Math.floor((srcHeight - panelCropH) / 2));

  const evenX1 = Math.floor(cropX1 / 2) * 2;
  const evenX2 = Math.floor(cropX2 / 2) * 2;
  const evenY = Math.floor(cropY / 2) * 2;

  const filterComplex = [
    `[0:v]crop=${panelCropW}:${panelCropH}:${evenX1}:${evenY},scale=1080:960[top]`,
    `[0:v]crop=${panelCropW}:${panelCropH}:${evenX2}:${evenY},scale=1080:960[bottom]`,
    `[top][bottom]vstack=inputs=2[v]`,
  ].join(';');

  return {
    filterComplex,
    outputMap: '[v]',
    renderWidth: 1080,
    renderHeight: 1920,
    panelWidth: 1080,
    panelHeight: 960,
  };
}

function buildTimedCropExpression(focusPlan, anchorMap, defaultX) {
  if (!focusPlan || focusPlan.length === 0) return `${defaultX}`;
  if (focusPlan.length === 1) return `${anchorMap.get(focusPlan[0].speaker) ?? defaultX}`;

  const MAX_EXPR_SEGMENTS = 16;
  const plan = focusPlan.map((turn) => ({ ...turn }));
  while (plan.length > MAX_EXPR_SEGMENTS) {
    let minDiff = Infinity;
    let mergeIdx = 0;
    for (let i = 0; i < plan.length - 1; i++) {
      const diff = Math.abs((anchorMap.get(plan[i].speaker) ?? defaultX) - (anchorMap.get(plan[i + 1].speaker) ?? defaultX));
      if (diff < minDiff) {
        minDiff = diff;
        mergeIdx = i;
      }
    }
    plan[mergeIdx].end = plan[mergeIdx + 1].end;
    plan.splice(mergeIdx + 1, 1);
  }

  // Build smooth transition expression across consecutive speaker turns
  const EASING_DURATION = 0.5; // 500ms smooth camera pan
  let expression = `${anchorMap.get(plan[plan.length - 1].speaker) ?? defaultX}`;

  for (let i = plan.length - 2; i >= 0; i--) {
    const currentTurn = plan[i];
    const nextTurn = plan[i + 1];
    const currentX = anchorMap.get(currentTurn.speaker) ?? defaultX;
    const nextX = anchorMap.get(nextTurn.speaker) ?? defaultX;

    if (currentX === nextX) {
      expression = `if(lt(t\\,${formatExprNumber(currentTurn.end)})\\,${currentX}\\,${expression})`;
    } else {
      const halfEase = EASING_DURATION / 2;
      const tStart = Math.max(0, currentTurn.end - halfEase);
      const tEnd = currentTurn.end + halfEase;
      const easingPart = buildFFmpegEasingCropX(currentX, nextX, tStart, tEnd);
      expression = `if(lt(t\\,${formatExprNumber(tStart)})\\,${currentX}\\,if(lt(t\\,${formatExprNumber(tEnd)})\\,${easingPart}\\,${expression}))`;
    }
  }

  return expression;
}

function getSpeakerOrder(speakerTurns) {
  const order = [];

  for (const turn of speakerTurns || []) {
    if (turn?.speaker && !order.includes(turn.speaker)) {
      order.push(turn.speaker);
    }
  }

  return order;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatExprNumber(value) {
  return Number(value).toFixed(2);
}

async function getFaceTrackingPlan({ videoPath, clip, speakerTurns, aspectRatio }) {
  if (!FACE_TRACKING_ENABLED || !['9:16', '1:1'].includes(aspectRatio)) {
    return [];
  }

  const relevantTurns = (speakerTurns || [])
    .filter((turn) => turn.end > clip.start && turn.start < clip.end)
    .map((turn) => ({
      speaker: turn.speaker,
      start: Math.max(0, turn.start - clip.start),
      end: Math.min(clip.end - clip.start, turn.end - clip.start),
    }))
    .filter((turn) => turn.end > turn.start);

  try {
    const payload = {
      videoPath,
      clipStart: clip.start,
      clipEnd: clip.end,
      speakerTurns: relevantTurns,
    };

    const result = await runFaceTrackingScript(payload);
    if (result.error) {
      console.warn(`   Face tracking fallback: ${result.error}`);
      return [];
    }

    if (result && Array.isArray(result.plan)) {
      console.log(`   Face tracking plan ready: ${result.plan.length} segment(s), ${result.debug?.tracks || 0} face track(s), ${result.wideIntervals?.length || 0} wide interval(s)${result.webcamBox ? ', webcam detected' : ''}`);
      return {
        plan: result.plan,
        wideIntervals: Array.isArray(result.wideIntervals) ? result.wideIntervals : [],
        webcamBox: result.webcamBox || null,
      };
    }
  } catch (err) {
    console.warn(`   Face tracking fallback: ${err.message}`);
  }

  return { plan: [], wideIntervals: [], webcamBox: null };
}

function runFaceTrackingScript(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve('scripts', 'face_tracking.py');
    const child = spawn(FACE_TRACKING_PYTHON, [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`gagal menjalankan Python face tracking: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || stdout.trim() || `face tracking exit code ${code}`));
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`output face tracking tidak valid: ${err.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Dapatkan informasi video menggunakan ffprobe.
 *
 * Audit M1: for an http(s) path this used to resolve a hardcoded 1280x720 with
 * duration 0. That silently lied about the geometry: a 1080p YouTube source was
 * treated as 720p, so a 9:16 solo crop came out ~33% narrower than intended and
 * split-screen panels were upscaled from a 720p crop. Callers that need real
 * geometry MUST probe an actual downloaded file; for a URL we now return null
 * so the caller is forced to handle "unknown" explicitly instead of trusting a
 * fabricated resolution.
 *
 * @param {string} videoPath
 * @returns {Promise<{width:number,height:number,duration:number,bitrate:number}|null>}
 */
function getVideoInfo(videoPath) {
  if (typeof videoPath === 'string' && (videoPath.startsWith('http://') || videoPath.startsWith('https://'))) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe error: ${err.message}`));
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) return reject(new Error('Tidak ada video stream ditemukan'));
      resolve({
        width: videoStream.width,
        height: videoStream.height,
        duration: parseFloat(metadata.format.duration) || 0,
        bitrate: parseInt(metadata.format.bit_rate) || 0,
      });
    });
  });
}

export { buildFaceTrackedCropX, calculateSafeFaceCropX };
