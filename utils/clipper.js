// utils/clipper.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import 'dotenv/config';
import { buildAudioCrossfadeFilter } from './boundarySnapper.js';
import { downloadClipSection } from './downloader.js';
import { generateAssSubtitles } from './subtitleGenerator.js';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './outputs';
const SPEAKER_TRACKING_ENABLED = process.env.SPEAKER_TRACKING_ENABLED !== 'false';
const SPEAKER_SWITCH_MIN_SECONDS = parseFloat(process.env.SPEAKER_SWITCH_MIN_SECONDS || '2.4');
const SPEAKER_POSITION_PADDING_RATIO = parseFloat(process.env.SPEAKER_POSITION_PADDING_RATIO || '0.14');
const FACE_TRACKING_ENABLED = process.env.FACE_TRACKING_ENABLED !== 'false';
const FACE_TRACKING_PYTHON = process.env.FACE_TRACKING_PYTHON || 'python';
const FACE_TRACKING_SAFE_MARGIN_RATIO = parseFloat(process.env.FACE_TRACKING_SAFE_MARGIN_RATIO || '0.18');

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
    `[0:v]crop=${targetWidth}:${cropHeight}:${validXExpr}:${soloY},scale=1080:1920,setsar=1[solo]`,
  ];

  if (Array.isArray(wideIntervals) && wideIntervals.length > 0) {
    const avgX1 = wideIntervals.reduce((acc, i) => acc + (i.x1 || srcWidth * 0.22), 0) / wideIntervals.length;
    const avgX2 = wideIntervals.reduce((acc, i) => acc + (i.x2 || srcWidth * 0.78), 0) / wideIntervals.length;

    const panelCropW = Math.min(srcWidth / 2, Math.floor(srcHeight * 9 / 8));
    const panelCropH = Math.min(srcHeight, 540);
    const cropX1 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(avgX1 - panelCropW / 2)));
    const cropX2 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(avgX2 - panelCropW / 2)));
    const cropY = Math.max(0, Math.floor((srcHeight - panelCropH) / 2));

    const evenX1 = Math.floor(cropX1 / 2) * 2;
    const evenX2 = Math.floor(cropX2 / 2) * 2;
    const evenY = Math.floor(cropY / 2) * 2;

    filterParts.push(`[0:v]crop=${panelCropW}:${panelCropH}:${evenX1}:${evenY},scale=1080:960,setsar=1[top]`);
    filterParts.push(`[0:v]crop=${panelCropW}:${panelCropH}:${evenX2}:${evenY},scale=1080:960,setsar=1[bottom]`);
    filterParts.push(`[top][bottom]vstack=inputs=2[split]`);

    const enableExpr = wideIntervals
      .map((intv) => `between(t\\,${Number(intv.start).toFixed(2)}\\,${Number(intv.end).toFixed(2)})`)
      .join('+');

    filterParts.push(`[solo][split]overlay=0:0:enable='${enableExpr}'[vraw]`);
  } else {
    filterParts[0] = `[0:v]crop=${targetWidth}:${cropHeight}:${validXExpr}:${soloY},scale=1080:1920,setsar=1[vraw]`;
  }

  let outputMap = '[vraw]';
  if (subtitleAssPath) {
    const escapedAss = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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

  const targetCamX = typeof camX === 'number'
    ? Math.max(0, Math.min(srcWidth - targetCamW, Math.floor(camX)))
    : 0;
  const targetCamY = typeof camY === 'number'
    ? Math.max(0, Math.min(srcHeight - targetCamH, Math.floor(camY)))
    : 0;

  const filterParts = [
    `[0:v]crop=${targetCamW}:${targetCamH}:${targetCamX}:${targetCamY},scale=1080:800:force_original_aspect_ratio=increase,crop=1080:800[cam]`,
    `[0:v]scale=1080:1120:force_original_aspect_ratio=decrease,pad=1080:1120:(ow-iw)/2:(oh-ih)/2:black[game]`,
    `[cam][game]vstack=inputs=2[vraw]`,
  ];

  let outputMap = '[vraw]';
  if (subtitleAssPath) {
    const escapedAss = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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
 * Potong video berdasarkan timestamp dan reframe ke aspect ratio yang diinginkan
 * @param {string} videoPath - Path source video
 * @param {Array} clips - Array clip dari AI analyzer [{start, end, title, ...}]
 * @param {string} jobId - ID job
 * @param {string} aspectRatio - '9:16' | '1:1' | '16:9'
 * @param {{ speakerTurns?: Array }} options
 * @returns {Promise<Array<{clipPath, title, ...}>>}
 */
export async function processClips(videoPath, clips, jobId, aspectRatio = '9:16', options = {}) {
  const outputDir = path.resolve(OUTPUT_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Dapatkan info video asli
  const videoInfo = await getVideoInfo(videoPath);
  const { width: srcWidth, height: srcHeight } = videoInfo;
  const speakerTurns = Array.isArray(options.speakerTurns) ? options.speakerTurns : [];
  const speakerOrder = getSpeakerOrder(speakerTurns);

  console.log(`📐 Source video: ${srcWidth}x${srcHeight}, AR: ${aspectRatio}`);

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

      let currentWidth = srcWidth;
      let currentHeight = srcHeight;
      if (tempSectionFile) {
        try {
          const secInfo = await getVideoInfo(tempSectionFile);
          currentWidth = secInfo.width || srcWidth;
          currentHeight = secInfo.height || srcHeight;
        } catch (_) {}
      }

      // Check if subtitles enabled and words available
      const subtitleConfig = options.subtitleConfig;
      if (subtitleConfig?.enabled) {
        const candidateWords = (Array.isArray(clip.words) && clip.words.length > 0)
          ? clip.words
          : (Array.isArray(options.words) ? options.words : []);

        const isAlreadyRelative = clip.start > 0 && candidateWords.every(
          (w) => (w.start || 0) < clip.start && (w.end || 0) <= (clip.end - clip.start) + 1.0
        );

        const clipWords = isAlreadyRelative
          ? candidateWords
          : candidateWords.filter(
              (w) => w && typeof w.word === 'string' && w.end > clip.start && w.start < clip.end
            );

        if (clipWords.length > 0) {
          const assContent = generateAssSubtitles(
            clipWords,
            clip.start,
            clip.end,
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

      await clipVideo(sourceForProcessing, outputPath, clipForProcessing, currentWidth, currentHeight, aspectRatio, {
        speakerTurns,
        speakerOrder,
        faceTrackingPlan,
        wideIntervals,
        subtitleAssPath: tempAssFile,
        layoutMode: options.layoutMode || 'standard',
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

    let cmd = ffmpeg(inputPath)
      .seekInput(clip.start)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .videoBitrate('2000k')
      .outputOptions([
        '-preset veryfast',
        '-crf 23',
        '-movflags +faststart', // streaming-friendly
        '-pix_fmt yuv420p',
      ]);

    const layoutMode = options.layoutMode || 'standard';

    if (layoutMode === 'gaming_streamer' && aspectRatio === '9:16') {
      const graph = buildGamingStreamerFilterGraph({
        srcWidth,
        srcHeight,
        subtitleAssPath: options.subtitleAssPath,
      });
      cmd = cmd.complexFilter(graph.filterComplex, graph.outputMap)
               .outputOptions(['-map 0:a?']);
    } else if ((layoutMode === 'split_screen' || layoutMode === 'auto_split') && aspectRatio === '9:16') {
      let graph;
      if (options.wideIntervals && options.wideIntervals.length > 0) {
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
        graph = buildAdaptiveSplitFilterGraph({
          srcWidth,
          srcHeight,
          soloCropXExpr: soloXExpr,
          wideIntervals: options.wideIntervals,
          subtitleAssPath: options.subtitleAssPath,
        });
      } else {
        graph = buildStackedSplitFilterGraph({
          srcWidth,
          srcHeight,
        });
        let filterComplex = graph.filterComplex;
        let outMap = graph.outputMap;
        if (options.subtitleAssPath) {
          const escapedAss = options.subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          filterComplex += `;${graph.outputMap}ass='${escapedAss}'[vout]`;
          outMap = '[vout]';
        }
        graph = { filterComplex, outputMap: outMap };
      }
      cmd = cmd.complexFilter(graph.filterComplex, graph.outputMap)
               .outputOptions(['-map 0:a?']);
    } else {
      const vfFilter = buildVideoFilter({
        srcWidth,
        srcHeight,
        aspectRatio,
        clip,
        speakerTurns: options.speakerTurns || [],
        speakerOrder: options.speakerOrder || [],
        faceTrackingPlan: options.faceTrackingPlan || [],
        subtitleAssPath: options.subtitleAssPath,
      });
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
      .on('error', (err) => {
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
    filters.push(`scale=1080:1920:force_original_aspect_ratio=decrease`);
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
    filters.push(`scale=1080:1080`);
  } else {
    filters.push(`scale=1280:720:force_original_aspect_ratio=decrease`);
    filters.push(`pad=1280:720:(ow-iw)/2:(oh-ih)/2:black`);
  }

  if (subtitleAssPath) {
    const escapedAssPath = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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

  // 3. Batasi maksimal 16 segmen agar tidak melebihi batas kedalaman ekspresi FFmpeg (eval stack overflow)
  const MAX_EXPR_SEGMENTS = 16;
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
      console.log(`   Face tracking plan ready: ${result.plan.length} segment(s), ${result.debug?.tracks || 0} face track(s), ${result.wideIntervals?.length || 0} wide interval(s)`);
      return {
        plan: result.plan,
        wideIntervals: Array.isArray(result.wideIntervals) ? result.wideIntervals : [],
      };
    }
  } catch (err) {
    console.warn(`   Face tracking fallback: ${err.message}`);
  }

  return { plan: [], wideIntervals: [] };
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
 * Dapatkan informasi video menggunakan ffprobe
 */
function getVideoInfo(videoPath) {
  if (typeof videoPath === 'string' && (videoPath.startsWith('http://') || videoPath.startsWith('https://'))) {
    return Promise.resolve({
      width: 1280,
      height: 720,
      duration: 0,
      bitrate: 0,
    });
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
