// tests/fixtures/testHarnessHelpers.js
/**
 * Shared Reference Implementations and Test Harness Helpers for ClipAIv2
 * Contains mathematical formulas, schema validators, filter builders, and trajectory samplers.
 */

import { checkSpeechCollision, snapBoundary } from '../../utils/boundarySnapper.js';

// ============================================================================
// F6: Audio Seam Crossfading Helpers
// ============================================================================
export const DEFAULT_FADE_DURATION = 0.030; // 30ms

export function buildAudioCrossfadeFilter(duration, fadeSec = DEFAULT_FADE_DURATION) {
  if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
    throw new Error(`Invalid duration for audio crossfade: ${duration}`);
  }
  const effectiveFade = duration < 2 * fadeSec ? duration / 2 : fadeSec;
  const fadeOutStart = Math.max(0, duration - effectiveFade);
  const dStr = effectiveFade.toFixed(3);
  const outStStr = fadeOutStart.toFixed(3);
  return `afade=t=in:st=0:d=${dStr},afade=t=out:st=${outStStr}:d=${dStr}`;
}

// ============================================================================
// F7 & F11: Discrete Sentence ID Prompting & Resolution
// ============================================================================
export function buildDiscreteSentencePrompt(sentencesList, duration, clipCount = 3) {
  if (!Array.isArray(sentencesList) || sentencesList.length === 0) {
    throw new Error('sentencesList must be a non-empty array');
  }
  const formattedLines = sentencesList.map((s) => {
    const spk = s.speaker ? ` [${s.speaker}]` : '';
    return `[${s.id}]${spk}: ${s.text}`;
  });

  return [
    `You are an expert viral video editor.`,
    `Video duration: ${duration} seconds. Total sentences: ${sentencesList.length}.`,
    `=== SENTENCE SEGMENTS ===`,
    ...formattedLines,
    `=========================`,
    `Select exactly ${clipCount} clips. For every clip, return:`,
    `- startSentenceId: (e.g. "s1")`,
    `- endSentenceId: (e.g. "s3")`,
    `- hookClassification: one of ["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]`,
    `- hookText: the text of the opening hook`,
    `- narrativeRationale: { setup, climax, conclusion, isCompleteArc }`,
    `- viralityScore: 0-100`,
    `- viralityRationale: explanation`,
  ].join('\n');
}

export function resolveSentenceIds(clip, map, context = {}) {
  if (!clip || typeof clip !== 'object') {
    throw new Error('Invalid clip object');
  }
  const { startSentenceId, endSentenceId } = clip;
  if (!startSentenceId || !map.has(startSentenceId)) {
    throw new Error(`Invalid startSentenceId "${startSentenceId}" not found in sentence map`);
  }
  if (!endSentenceId || !map.has(endSentenceId)) {
    throw new Error(`Invalid endSentenceId "${endSentenceId}" not found in sentence map`);
  }

  const startSentence = map.get(startSentenceId);
  const endSentence = map.get(endSentenceId);

  if (startSentence.index > endSentence.index) {
    throw new Error(`startSentenceId "${startSentenceId}" (index ${startSentence.index}) cannot be after endSentenceId "${endSentenceId}" (index ${endSentence.index})`);
  }

  const startSnap = snapBoundary(startSentence.start, {
    ...context,
    boundaryType: 'start',
  });
  const endSnap = snapBoundary(endSentence.end, {
    ...context,
    boundaryType: 'end',
  });

  return {
    ...clip,
    start: startSnap.snappedTime,
    end: endSnap.snappedTime,
    resolvedSentences: {
      count: endSentence.index - startSentence.index + 1,
      startText: startSentence.text,
      endText: endSentence.text,
    },
    snappingDetails: {
      start: startSnap,
      end: endSnap,
    },
  };
}

// ============================================================================
// F12: Face Tracking Trajectory Smoothing & Speaker Anchor Mapping
// ============================================================================
export function smoothFaceTrajectory(samples, windowSize = 5) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const smoothed = [];
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < samples.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(samples.length, i + half + 1);
    const window = samples.slice(start, end);
    const avgX = window.reduce((sum, s) => sum + s.x, 0) / window.length;

    smoothed.push({
      time: samples[i].time,
      x: parseFloat(avgX.toFixed(4)),
    });
  }

  return smoothed;
}

export function computeSpeakerAnchorMap(detections, speakers = []) {
  const anchorMap = new Map();
  const speakerGroups = new Map();

  for (const d of detections || []) {
    if (d && d.speaker && typeof d.x === 'number') {
      if (!speakerGroups.has(d.speaker)) speakerGroups.set(d.speaker, []);
      speakerGroups.get(d.speaker).push(d.x);
    }
  }

  for (const spk of speakers) {
    if (speakerGroups.has(spk) && speakerGroups.get(spk).length > 0) {
      const xs = speakerGroups.get(spk);
      const median = xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const clamped = Math.max(0.15, Math.min(0.85, median));
      anchorMap.set(spk, parseFloat(clamped.toFixed(3)));
    } else {
      anchorMap.set(spk, 0.5);
    }
  }

  return anchorMap;
}

// ============================================================================
// F13: Smooth Camera Easing & Trajectory Sampling
// ============================================================================
export function cosineEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

export function smoothstepEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return clamped * clamped * (3 - 2 * clamped);
}

export function createCameraTrajectory(x1, x2, tStart, tEnd, easing = 'cosine') {
  const duration = Math.max(0.001, tEnd - tStart);
  const easeFn = easing === 'smoothstep' ? smoothstepEase : cosineEase;

  return (t) => {
    if (t <= tStart) return x1;
    if (t >= tEnd) return x2;
    const p = (t - tStart) / duration;
    return x1 + (x2 - x1) * easeFn(p);
  };
}

export function buildFFmpegEasingCropX(x1, x2, tStart, tEnd) {
  const dur = (tEnd - tStart).toFixed(3);
  const tStartStr = tStart.toFixed(3);
  const tEndStr = tEnd.toFixed(3);
  const dx = (x2 - x1).toFixed(1);

  return `if(lt(t\\,${tStartStr})\\,${x1}\\,if(lt(t\\,${tEndStr})\\,${x1}+(${dx})*(0.5-0.5*cos(3.14159265*(t-${tStartStr})/${dur}))\\,${x2}))`;
}

export function sampleTrajectory(trajectoryFn, startSec, endSec, fps = 30) {
  const dt = 1.0 / fps;
  const samples = [];
  let prevX = trajectoryFn(startSec);

  let frame = 0;
  for (let t = startSec; t <= endSec + 1e-6; t += dt) {
    const x = trajectoryFn(t);
    const deltaX = Math.abs(x - prevX);
    samples.push({
      frame,
      time: parseFloat(t.toFixed(4)),
      x: parseFloat(x.toFixed(2)),
      deltaX: parseFloat(deltaX.toFixed(2)),
    });
    prevX = x;
    frame++;
  }

  return samples;
}

// ============================================================================
// F14: Stacked Split-Screen Filter Graph Builder
// ============================================================================
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

// ============================================================================
// F15: Production 9:16 Conformance Dimensions Calculator
// ============================================================================
export function calculate916CropDimensions(srcWidth, srcHeight) {
  if (typeof srcWidth !== 'number' || typeof srcHeight !== 'number' || srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Invalid source dimensions: ${srcWidth}x${srcHeight}`);
  }

  let targetWidth = Math.floor((srcHeight * 9 / 16) / 2) * 2;
  if (targetWidth > srcWidth) {
    targetWidth = Math.floor(srcWidth / 2) * 2;
  }

  let targetHeight = Math.floor((targetWidth * 16 / 9) / 2) * 2;
  if (targetHeight > srcHeight) {
    targetHeight = Math.floor(srcHeight / 2) * 2;
    targetWidth = Math.floor((targetHeight * 9 / 16) / 2) * 2;
  }

  const defaultX = Math.floor((srcWidth - targetWidth) / 4) * 2;
  const defaultY = Math.floor((srcHeight - targetHeight) / 4) * 2;

  return {
    cropWidth: targetWidth,
    cropHeight: targetHeight,
    defaultX,
    defaultY,
    renderWidth: 1080,
    renderHeight: 1920,
  };
}

// ============================================================================
// F16: Automated Verification Validators
// ============================================================================
export function verifyBoundaryPrecision(clips, sentences, silences, words) {
  const failures = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];

    const nearSentenceStart = sentences.some((s) => Math.abs(clip.start - s.start) <= 0.1001 || Math.abs(clip.start - s.end) <= 0.1001);
    const inSilenceStart = silences.some((sil) => sil.duration >= 0.3 && clip.start >= sil.start - 0.05 && clip.start <= sil.end + 0.05);

    if (!nearSentenceStart && !inSilenceStart) {
      failures.push(`Clip ${i + 1} start (${clip.start}s) is not within 100ms of a sentence boundary or silence gap`);
    }

    const nearSentenceEnd = sentences.some((s) => Math.abs(clip.end - s.start) <= 0.1001 || Math.abs(clip.end - s.end) <= 0.1001);
    const inSilenceEnd = silences.some((sil) => sil.duration >= 0.3 && clip.end >= sil.start - 0.05 && clip.end <= sil.end + 0.05);

    if (!nearSentenceEnd && !inSilenceEnd) {
      failures.push(`Clip ${i + 1} end (${clip.end}s) is not within 100ms of a sentence boundary or silence gap`);
    }

    const startCollision = checkSpeechCollision(clip.start, words);
    if (startCollision.collides) {
      failures.push(`Clip ${i + 1} start (${clip.start}s) cuts during word "${startCollision.conflictingWord.word}"`);
    }

    const endCollision = checkSpeechCollision(clip.end, words);
    if (endCollision.collides) {
      failures.push(`Clip ${i + 1} end (${clip.end}s) cuts during word "${endCollision.conflictingWord.word}"`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export function verifyCameraFramingSmoothness(sampledFrames, maxAllowedDelta = 25) {
  const maxDelta = Math.max(0, ...sampledFrames.map((f) => f.deltaX || 0));
  return {
    passed: maxDelta <= maxAllowedDelta,
    maxDelta,
  };
}

export function verifyVideoConformance(probeResult) {
  const errors = [];
  if (!probeResult || typeof probeResult !== 'object') {
    return { passed: false, errors: ['Null or invalid probe result'] };
  }

  if (probeResult.width !== 1080) {
    errors.push(`Invalid video width: ${probeResult.width} (expected 1080)`);
  }
  if (probeResult.height !== 1920) {
    errors.push(`Invalid video height: ${probeResult.height} (expected 1920)`);
  }
  if (typeof probeResult.duration !== 'number' || probeResult.duration <= 0) {
    errors.push(`Invalid video duration: ${probeResult.duration} (expected > 0)`);
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}
