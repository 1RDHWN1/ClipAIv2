// utils/audioPeakDetector.js
import fs from 'fs';
import { spawn } from 'child_process';

/**
 * Audio Energy & Excitement Peak Detection Engine (Milestone 3)
 *
 * Scans audio/video streams using native FFmpeg EBU R128 loudness analysis
 * to identify vocal excitement, screams, cheers, hype moments, and crowd reactions.
 *
 * Essential for universal multi-content clipping (Gaming streamers, IRL streams, Sports).
 */

const DEFAULT_MOMENTARY_INTERVAL_SEC = 0.2; // 200ms sampling
const QUIET_FLOOR_LUFS = -60.0;             // Ignore noise floor below -60 LUFS

/**
 * Parse FFmpeg EBU R128 stdout/stderr stream into time-series loudness samples.
 * @param {string} outputText
 * @returns {Array<{ time: number, lufs: number }>}
 */
export function parseEbur128Output(outputText) {
  if (!outputText || typeof outputText !== 'string') {
    return [];
  }

  const samples = [];
  const lines = outputText.split(/\r?\n/);

  let currentPtsTime = null;

  for (const line of lines) {
    // Matches: frame:3 pts:13230 pts_time:0.3
    const ptsMatch = line.match(/pts_time:([\d.]+)/);
    if (ptsMatch) {
      currentPtsTime = parseFloat(ptsMatch[1]);
      continue;
    }

    // Matches: lavfi.r128.M=-21.459
    const lufsMatch = line.match(/lavfi\.r128\.M=([-\d.]+)/);
    if (lufsMatch && currentPtsTime !== null) {
      const lufs = parseFloat(lufsMatch[1]);
      if (Number.isFinite(lufs) && lufs > QUIET_FLOOR_LUFS) {
        samples.push({
          time: Math.round(currentPtsTime * 100) / 100,
          lufs: Math.round(lufs * 10) / 10,
        });
      }
      currentPtsTime = null;
    }
  }

  return samples;
}

/**
 * Compute statistical loudness metrics from samples.
 * @param {Array<{ time: number, lufs: number }>} samples
 * @returns {{ mean: number, max: number, min: number, stdDev: number, threshold: number }}
 */
export function calculateLoudnessStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { mean: -24.0, max: -24.0, min: -24.0, stdDev: 0, threshold: -16.0 };
  }

  const values = samples.map((s) => s.lufs);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  const max = Math.max(...values);
  const min = Math.min(...values);

  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Dynamic excitement threshold: at least 1.2 standard deviations above average, capped between -18 and -12 LUFS
  const dynamicThreshold = Math.min(-12.0, Math.max(-18.0, mean + Math.max(4.0, stdDev * 1.2)));

  return {
    mean: Math.round(mean * 10) / 10,
    max: Math.round(max * 10) / 10,
    min: Math.round(min * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    threshold: Math.round(dynamicThreshold * 10) / 10,
  };
}

/**
 * Detect continuous or clustered peak intervals exceeding loudness threshold.
 * @param {Array<{ time: number, lufs: number }>} samples
 * @param {number} threshold - Loudness threshold in LUFS
 * @param {Object} [options={}]
 * @param {number} [options.minPeakDuration=0.4] - Minimum duration in seconds
 * @param {number} [options.mergeGapSec=1.5] - Merge adjacent peaks closer than gap
 * @returns {Array<{ start: number, end: number, peakLufs: number, duration: number, intensityScore: number }>}
 */
export function clusterPeakIntervals(samples, threshold, options = {}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return [];
  }

  const minDuration = typeof options.minPeakDuration === 'number' ? options.minPeakDuration : 0.4;
  const mergeGap = typeof options.mergeGapSec === 'number' ? options.mergeGapSec : 1.5;

  const rawIntervals = [];
  let currentStart = null;
  let currentMax = -Infinity;
  let lastTime = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.lufs >= threshold) {
      if (currentStart === null) {
        currentStart = s.time;
        currentMax = s.lufs;
      } else {
        currentMax = Math.max(currentMax, s.lufs);
      }
      lastTime = s.time;
    } else if (currentStart !== null) {
      const end = lastTime || currentStart;
      if (end - currentStart >= minDuration) {
        rawIntervals.push({
          start: currentStart,
          end: Math.round((end + 0.1) * 100) / 100,
          peakLufs: currentMax,
        });
      }
      currentStart = null;
      currentMax = -Infinity;
    }
  }

  if (currentStart !== null && lastTime !== null && lastTime - currentStart >= minDuration) {
    rawIntervals.push({
      start: currentStart,
      end: Math.round((lastTime + 0.1) * 100) / 100,
      peakLufs: currentMax,
    });
  }

  if (rawIntervals.length === 0) {
    return [];
  }

  // Merge adjacent peaks closer than mergeGap
  const merged = [];
  let current = { ...rawIntervals[0] };

  for (let i = 1; i < rawIntervals.length; i++) {
    const next = rawIntervals[i];
    if (next.start - current.end <= mergeGap) {
      current.end = Math.max(current.end, next.end);
      current.peakLufs = Math.max(current.peakLufs, next.peakLufs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  // Compute intensity score (0-100) normalized relative to threshold and ceiling (-6 LUFS)
  return merged.map((m) => {
    const duration = Math.round((m.end - m.start) * 100) / 100;
    // Map peakLufs [-20 .. -6] to [50 .. 100]
    const normalized = Math.min(100, Math.max(40, Math.round(((m.peakLufs - threshold) / Math.max(1, -6 - threshold)) * 50 + 50)));
    return {
      start: m.start,
      end: m.end,
      peakLufs: m.peakLufs,
      duration,
      intensityScore: normalized,
    };
  });
}

/**
 * Runs FFmpeg EBU R128 loudness analysis on audio/video media.
 * Ultra-fast execution (~100x real-time, ~10s for 1 hour of audio).
 *
 * @param {string} mediaPath
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=45000]
 * @returns {Promise<{ stats: Object, peaks: Array, samples: Array }>}
 */
export async function detectAudioPeaks(mediaPath, options = {}) {
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    return {
      stats: { mean: -24.0, max: -24.0, min: -24.0, stdDev: 0, threshold: -16.0 },
      peaks: [],
      samples: [],
    };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 45000;

  return new Promise((resolve) => {
    // EBU R128 momentary loudness pass, discarding video decode (-vn) for maximum speed
    const args = [
      '-hide_banner',
      '-nostats',
      '-i', mediaPath,
      '-vn',
      '-af', 'ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=-',
      '-f', 'null',
      '-',
    ];

    let ffmpegProc;
    let timer = null;

    try {
      ffmpegProc = spawn('ffmpeg', args);
      timer = setTimeout(() => {
        if (ffmpegProc && !ffmpegProc.killed) {
          try { ffmpegProc.kill('SIGKILL'); } catch (_) {}
        }
      }, timeoutMs);
    } catch (err) {
      if (timer) clearTimeout(timer);
      console.warn(`[audioPeakDetector] Failed to spawn FFmpeg: ${err.message}`);
      return resolve({
        stats: { mean: -24.0, max: -24.0, min: -24.0, stdDev: 0, threshold: -16.0 },
        peaks: [],
        samples: [],
      });
    }

    let outputData = '';
    ffmpegProc.stdout.on('data', (chunk) => {
      outputData += chunk.toString();
    });
    ffmpegProc.stderr.on('data', (chunk) => {
      outputData += chunk.toString();
    });

    ffmpegProc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      console.warn(`[audioPeakDetector] FFmpeg process error: ${err.message}`);
      resolve({
        stats: { mean: -24.0, max: -24.0, min: -24.0, stdDev: 0, threshold: -16.0 },
        peaks: [],
        samples: [],
      });
    });

    ffmpegProc.on('close', () => {
      if (timer) clearTimeout(timer);
      const samples = parseEbur128Output(outputData);
      const stats = calculateLoudnessStats(samples);
      const peaks = clusterPeakIntervals(samples, stats.threshold, options);

      console.log(`🔊 [audioPeakDetector] Analysis complete: ${samples.length} samples, avg ${stats.mean} LUFS, peak ${stats.max} LUFS, ${peaks.length} excitement zone(s)`);

      resolve({ stats, peaks, samples });
    });
  });
}

/**
 * Annotate discrete sentence segments with audio hype scores and peak indicators.
 *
 * @param {Array<Object>} sentences
 * @param {Array<Object>} peaks
 * @returns {Array<Object>} sentences with hypeScore & isHypePeak
 */
export function annotateSentencesWithAudioPeaks(sentences, peaks = []) {
  if (!Array.isArray(sentences)) {
    return [];
  }
  if (!Array.isArray(peaks) || peaks.length === 0) {
    return sentences.map((s) => ({ ...s, hypeScore: 0, isHypePeak: false }));
  }

  return sentences.map((s) => {
    const sStart = Number(s.start) || 0;
    const sEnd = Number(s.end) || sStart + 1.0;

    // Find any overlapping peak interval
    const overlapping = peaks.filter((p) => p.end > sStart && p.start < sEnd);

    if (overlapping.length > 0) {
      const best = overlapping.reduce((prev, curr) => (curr.intensityScore > prev.intensityScore ? curr : prev), overlapping[0]);
      return {
        ...s,
        hypeScore: best.intensityScore,
        isHypePeak: true,
        peakLufs: best.peakLufs,
      };
    }

    return {
      ...s,
      hypeScore: 0,
      isHypePeak: false,
    };
  });
}
