// utils/silenceDetector.js
import fs from 'fs';
import { spawn } from 'child_process';

/**
 * Dual-Layer Silence Detection Engine (Requirement R1 / Feature F3)
 *
 * Combines:
 *  1. Native FFmpeg acoustic silence detection (`silencedetect=noise=-30dB:d=0.3`)
 *  2. Linguistic word-gap silence detection (`words[i+1].start - words[i].end >= 0.3`)
 *
 * Produces a unified, sorted, non-overlapping array of SilenceInterval objects.
 */

const DEFAULT_NOISE_THRESHOLD = '-30dB';
const DEFAULT_MIN_DURATION = 0.3; // 300ms

/**
 * Parses FFmpeg stderr output to extract acoustic silence intervals.
 * @param {string} audioPath
 * @param {Object} [options={}]
 * @param {string} [options.noiseThreshold='-30dB']
 * @param {number} [options.minDuration=0.3]
 * @returns {Promise<Array<{ start: number, end: number, duration: number, source: 'acoustic' }>>}
 */
export async function detectAcousticSilence(audioPath, options = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return [];
  }

  const noiseThreshold = options.noiseThreshold || DEFAULT_NOISE_THRESHOLD;
  const minDuration = typeof options.minDuration === 'number' ? options.minDuration : DEFAULT_MIN_DURATION;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000;

  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-i', audioPath,
      '-af', `silencedetect=noise=${noiseThreshold}:d=${minDuration}`,
      '-f', 'null',
      '-',
    ];

    let ffmpegProc;
    let timer = null;
    try {
      ffmpegProc = spawn('ffmpeg', args);
      timer = setTimeout(() => {
        if (ffmpegProc && !ffmpegProc.killed) {
          try {
            ffmpegProc.kill('SIGKILL');
          } catch (_) {}
        }
      }, timeoutMs);
    } catch (err) {
      if (timer) clearTimeout(timer);
      console.warn(`[silenceDetector] Failed to spawn FFmpeg for acoustic silence detection: ${err.message}`);
      return resolve([]);
    }

    let stderrData = '';
    ffmpegProc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    ffmpegProc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      console.warn(`[silenceDetector] FFmpeg process error: ${err.message}`);
      resolve([]);
    });

    ffmpegProc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const intervals = [];
      const lines = stderrData.split(/\r?\n/);

      let currentStart = null;
      let totalDuration = null;

      // Extract duration if present
      const durationMatch = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durationMatch) {
        const hours = parseFloat(durationMatch[1]);
        const minutes = parseFloat(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        totalDuration = hours * 3600 + minutes * 60 + seconds;
      }

      for (const line of lines) {
        // Look for silence_start
        const startMatch = line.match(/silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/);
        if (startMatch) {
          currentStart = Math.max(0, parseFloat(startMatch[1]));
          continue;
        }

        // Look for silence_end
        const endMatch = line.match(/silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*\|\s*silence_duration:\s*(-?[0-9]+(?:\.[0-9]+)?)/);
        if (endMatch) {
          const end = parseFloat(endMatch[1]);
          const duration = parseFloat(endMatch[2]);
          const start = currentStart !== null ? currentStart : Math.max(0, end - duration);

          if (duration >= minDuration && end > start) {
            intervals.push({
              start: parseFloat(start.toFixed(3)),
              end: parseFloat(end.toFixed(3)),
              duration: parseFloat(duration.toFixed(3)),
              source: 'acoustic',
            });
          }
          currentStart = null;
        }
      }

      // If trailing silence reached EOF without a silence_end tag
      if (currentStart !== null && totalDuration !== null && totalDuration > currentStart) {
        const duration = totalDuration - currentStart;
        if (duration >= minDuration) {
          intervals.push({
            start: parseFloat(currentStart.toFixed(3)),
            end: parseFloat(totalDuration.toFixed(3)),
            duration: parseFloat(duration.toFixed(3)),
            source: 'acoustic',
          });
        }
      }

      resolve(intervals);
    });
  });
}

/**
 * Extracts silence intervals from linguistic word gaps.
 * @param {Array<{ word: string, start: number, end: number }>} words
 * @param {Object} [options={}]
 * @param {number} [options.minDuration=0.3]
 * @param {number} [options.totalDuration]
 * @returns {Array<{ start: number, end: number, duration: number, source: 'linguistic' }>>}
 */
export function detectLinguisticSilence(words, options = {}) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const minDuration = typeof options.minDuration === 'number' ? options.minDuration : DEFAULT_MIN_DURATION;
  const totalDuration = typeof options.totalDuration === 'number' ? options.totalDuration : null;

  const validWords = words
    .filter((w) => (
      w &&
      typeof w.start === 'number' &&
      Number.isFinite(w.start) &&
      w.start >= 0 &&
      typeof w.end === 'number' &&
      Number.isFinite(w.end) &&
      w.end >= w.start
    ))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (validWords.length === 0) {
    return [];
  }

  const intervals = [];

  // 1. Lead-in silence (0 to first word start)
  if (validWords[0].start >= minDuration) {
    intervals.push({
      start: 0,
      end: parseFloat(validWords[0].start.toFixed(3)),
      duration: parseFloat(validWords[0].start.toFixed(3)),
      source: 'linguistic',
    });
  }

  // 2. Inter-word gaps tracking maxEndSoFar to eliminate false silence during crosstalk
  let maxEndSoFar = validWords[0].end;

  for (let i = 1; i < validWords.length; i++) {
    const nextStart = validWords[i].start;
    const gap = nextStart - maxEndSoFar;

    if (gap >= minDuration) {
      intervals.push({
        start: parseFloat(maxEndSoFar.toFixed(3)),
        end: parseFloat(nextStart.toFixed(3)),
        duration: parseFloat(gap.toFixed(3)),
        source: 'linguistic',
      });
    }

    if (validWords[i].end > maxEndSoFar) {
      maxEndSoFar = validWords[i].end;
    }
  }

  // 3. Trailing silence (from maxEndSoFar to totalDuration)
  if (totalDuration !== null && totalDuration - maxEndSoFar >= minDuration) {
    const trailingGap = totalDuration - maxEndSoFar;
    intervals.push({
      start: parseFloat(maxEndSoFar.toFixed(3)),
      end: parseFloat(totalDuration.toFixed(3)),
      duration: parseFloat(trailingGap.toFixed(3)),
      source: 'linguistic',
    });
  }

  return intervals;
}

/**
 * Merges acoustic and linguistic silence intervals into a sorted, non-overlapping array.
 * @param {Array<Object>} acousticIntervals
 * @param {Array<Object>} linguisticIntervals
 * @param {number} [minDuration=0.3]
 * @returns {Array<{ start: number, end: number, duration: number, source: 'acoustic'|'linguistic'|'hybrid' }>}
 */
export function mergeSilenceIntervals(acousticIntervals = [], linguisticIntervals = [], minDuration = DEFAULT_MIN_DURATION) {
  const all = [...(acousticIntervals || []), ...(linguisticIntervals || [])]
    .filter((it) => (
      it &&
      typeof it.start === 'number' &&
      Number.isFinite(it.start) &&
      typeof it.end === 'number' &&
      Number.isFinite(it.end) &&
      it.start >= 0 &&
      it.end > it.start
    ))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (all.length === 0) {
    return [];
  }

  const merged = [];
  let current = {
    start: all[0].start,
    end: all[0].end,
    source: all[0].source || 'acoustic',
  };

  for (let i = 1; i < all.length; i++) {
    const next = all[i];

    // Check if next interval overlaps or is immediately adjacent (within 50ms)
    if (next.start <= current.end + 0.05) {
      current.end = Math.max(current.end, next.end);
      if (current.source !== next.source) {
        current.source = 'hybrid';
      }
    } else {
      const duration = current.end - current.start;
      if (duration >= minDuration) {
        merged.push({
          start: parseFloat(current.start.toFixed(3)),
          end: parseFloat(current.end.toFixed(3)),
          duration: parseFloat(duration.toFixed(3)),
          source: current.source,
        });
      }
      current = {
        start: next.start,
        end: next.end,
        source: next.source || 'acoustic',
      };
    }
  }

  const lastDuration = current.end - current.start;
  if (lastDuration >= minDuration) {
    merged.push({
      start: parseFloat(current.start.toFixed(3)),
      end: parseFloat(current.end.toFixed(3)),
      duration: parseFloat(lastDuration.toFixed(3)),
      source: current.source,
    });
  }

  return merged;
}

/**
 * Main dual-layer silence detection entrypoint.
 *
 * @param {Object} params
 * @param {string} [params.audioPath] - Path to audio file for FFmpeg analysis
 * @param {Array<{ word: string, start: number, end: number }>} [params.words=[]] - Word tokens for linguistic gap detection
 * @param {number} [params.totalDuration] - Total duration of audio in seconds
 * @param {string} [params.noiseThreshold='-30dB'] - FFmpeg noise threshold
 * @param {number} [params.minDuration=0.3] - Minimum silence duration in seconds
 * @returns {Promise<Array<{ start: number, end: number, duration: number, source: 'acoustic'|'linguistic'|'hybrid' }>>}
 */
export async function detectSilence({
  audioPath,
  words = [],
  totalDuration,
  noiseThreshold = DEFAULT_NOISE_THRESHOLD,
  minDuration = DEFAULT_MIN_DURATION,
} = {}) {
  let acoustic = [];
  if (audioPath) {
    try {
      acoustic = await detectAcousticSilence(audioPath, { noiseThreshold, minDuration });
    } catch (err) {
      console.warn(`[silenceDetector] Acoustic silence detection skipped: ${err.message}`);
    }
  }

  const linguistic = detectLinguisticSilence(words, { minDuration, totalDuration });
  return mergeSilenceIntervals(acoustic, linguistic, minDuration);
}

export default detectSilence;
