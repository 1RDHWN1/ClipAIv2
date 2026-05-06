// utils/clipper.js
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import 'dotenv/config';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './outputs';
const SPEAKER_TRACKING_ENABLED = process.env.SPEAKER_TRACKING_ENABLED !== 'false';
const SPEAKER_SWITCH_MIN_SECONDS = parseFloat(process.env.SPEAKER_SWITCH_MIN_SECONDS || '2.4');
const SPEAKER_POSITION_PADDING_RATIO = parseFloat(process.env.SPEAKER_POSITION_PADDING_RATIO || '0.14');
const FACE_TRACKING_ENABLED = process.env.FACE_TRACKING_ENABLED !== 'false';
const FACE_TRACKING_PYTHON = process.env.FACE_TRACKING_PYTHON || 'python';
const FACE_TRACKING_SAFE_MARGIN_RATIO = parseFloat(process.env.FACE_TRACKING_SAFE_MARGIN_RATIO || '0.18');

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

    console.log(`✂️  Processing clip ${i + 1}/${clips.length}: ${clip.start}s - ${clip.end}s`);

    const faceTrackingPlan = await getFaceTrackingPlan({
      videoPath,
      clip,
      speakerTurns,
      aspectRatio,
    });

    await clipVideo(videoPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, {
      speakerTurns,
      speakerOrder,
      faceTrackingPlan,
    });

    const fileSize = fs.statSync(outputPath).size;
    results.push({
      ...clip,
      clipIndex: i + 1,
      filename: outputFilename,
      outputPath,
      fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
      duration: Math.round(clip.end - clip.start),
    });

    console.log(`   ✅ Clip ${i + 1} done: ${outputFilename} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
  }

  return results;
}

/**
 * Proses satu clip dengan FFmpeg
 */
function clipVideo(inputPath, outputPath, clip, srcWidth, srcHeight, aspectRatio, options = {}) {
  return new Promise((resolve, reject) => {
    const duration = clip.end - clip.start;

    // Hitung filter untuk reframe
    const vfFilter = buildVideoFilter({
      srcWidth,
      srcHeight,
      aspectRatio,
      clip,
      speakerTurns: options.speakerTurns || [],
      speakerOrder: options.speakerOrder || [],
      faceTrackingPlan: options.faceTrackingPlan || [],
    });

    let cmd = ffmpeg(inputPath)
      .seekInput(clip.start)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .videoBitrate('2000k')
      .outputOptions([
        '-preset fast',
        '-crf 23',
        '-movflags +faststart', // streaming-friendly
        '-pix_fmt yuv420p',
      ]);

    if (vfFilter) {
      cmd = cmd.videoFilters(vfFilter);
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
function buildVideoFilter({ srcWidth, srcHeight, aspectRatio, clip, speakerTurns, speakerOrder, faceTrackingPlan }) {
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
      x: calculateSafeFaceCropX({
        centerX: Number(segment.center_x),
        faceWidth: Number(segment.face_width || 0),
        cropWidth,
        maxX,
      }),
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && Number.isFinite(segment.x));

  if (normalizedPlan.length === 0) {
    return null;
  }

  if (normalizedPlan.length === 1) {
    return `${normalizedPlan[0].x}`;
  }

  let expression = `${defaultX}`;
  for (let i = normalizedPlan.length - 1; i >= 0; i--) {
    const segment = normalizedPlan[i];
    expression = `if(lt(t\\,${formatExprNumber(segment.end)})\\,${segment.x}\\,${expression})`;
  }

  return expression;
}

function calculateSafeFaceCropX({ centerX, faceWidth, cropWidth, maxX }) {
  if (!Number.isFinite(centerX)) {
    return 0;
  }

  if (!Number.isFinite(faceWidth) || faceWidth <= 0) {
    return clamp(Math.round(centerX - (cropWidth / 2)), 0, maxX);
  }

  const safeMargin = cropWidth * FACE_TRACKING_SAFE_MARGIN_RATIO;
  const desiredHalfFace = Math.max(faceWidth * 0.8, faceWidth / 2);
  const leftBound = centerX - desiredHalfFace - safeMargin;
  const rightBound = centerX + desiredHalfFace + safeMargin;

  let cropX = centerX - (cropWidth / 2);
  if (cropX > leftBound) {
    cropX = leftBound;
  }
  if ((cropX + cropWidth) < rightBound) {
    cropX = rightBound - cropWidth;
  }

  return clamp(Math.round(cropX), 0, maxX);
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

function buildTimedCropExpression(focusPlan, anchorMap, defaultX) {
  let expression = `${defaultX}`;

  for (let i = focusPlan.length - 1; i >= 0; i--) {
    const turn = focusPlan[i];
    const x = anchorMap.get(turn.speaker) ?? defaultX;
    expression = `if(lt(t\\,${formatExprNumber(turn.end)})\\,${x}\\,${expression})`;
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

    if (Array.isArray(result.plan) && result.plan.length > 0) {
      console.log(`   Face tracking plan ready: ${result.plan.length} segment(s), ${result.debug?.tracks || 0} face track(s)`);
      return result.plan;
    }
  } catch (err) {
    console.warn(`   Face tracking fallback: ${err.message}`);
  }

  return [];
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
