// utils/boundarySnapper.js
/**
 * Boundary Snapping Engine & Active Speech Protection (Requirement R1 / Features F4, F5)
 *
 * Automatically snaps proposed clip start and end boundaries to:
 *  1. The nearest sentence boundary within maxToleranceMs (default 100ms).
 *  2. Natural acoustic/linguistic silence intervals of duration >= 300ms.
 *  3. Nearest inter-word gap if no sentence or silence is within tolerance.
 *
 * HARD INVARIANT (Feature F5):
 *  For all w in words: T_snapped not in (w.start, w.end).
 *  Never allow a cut point to fall inside an active spoken word.
 */

const DEFAULT_MAX_TOLERANCE_MS = 100;
const DEFAULT_MIN_SILENCE_DURATION = 0.3; // 300ms
const DEFAULT_SAFETY_PADDING_SEC = 0.030; // 30ms padding in silence
export const DEFAULT_FADE_DURATION = 0.030; // 30ms

/**
 * Builds the FFmpeg audio filter expression for seamless boundary fading (Feature F6).
 *
 * Invariant:
 * Applies 30ms audio seam fades at clip boundaries to eliminate pop/click artifacts.
 * Filter graph: afade=t=in:st=0:d=0.030,afade=t=out:st=${duration - 0.030}:d=0.030
 *
 * @param {number} duration - Clip duration in seconds
 * @param {number} [fadeSec=0.030] - Desired fade duration in seconds
 * @returns {string} FFmpeg audio filter string
 */
export function buildAudioCrossfadeFilter(duration, fadeSec = DEFAULT_FADE_DURATION) {
  if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
    throw new Error(`Invalid duration for audio crossfade: ${duration}`);
  }

  const validFade = typeof fadeSec === 'number' && !isNaN(fadeSec) && fadeSec > 0
    ? fadeSec
    : DEFAULT_FADE_DURATION;

  // If clip is shorter than 2 * fadeSec, clamp each fade to duration / 2
  const effectiveFade = duration < 2 * validFade ? duration / 2 : validFade;
  const fadeOutStart = Math.max(0, duration - effectiveFade);

  const dStr = effectiveFade.toFixed(3);
  const outStStr = fadeOutStart.toFixed(3);

  return `afade=t=in:st=0:d=${dStr},afade=t=out:st=${outStStr}:d=${dStr}`;
}

/**
 * Checks whether a given timestamp collides with any active spoken word token.
 *
 * @param {number} time - Timestamp in seconds
 * @param {Array<{ word: string, start: number, end: number }>} words
 * @param {number} [epsilon=1e-6]
 * @returns {{ collides: boolean, conflictingWord: Object|null }}
 */
export function checkSpeechCollision(time, words = [], epsilon = 1e-6) {
  if (!Array.isArray(words) || words.length === 0 || typeof time !== 'number' || !Number.isFinite(time)) {
    return { collides: false, conflictingWord: null };
  }

  for (const w of words) {
    if (w && typeof w.start === 'number' && typeof w.end === 'number' && Number.isFinite(w.start) && Number.isFinite(w.end)) {
      if (time > w.start + epsilon && time < w.end - epsilon) {
        return { collides: true, conflictingWord: w };
      }
    }
  }

  return { collides: false, conflictingWord: null };
}

/**
 * Snaps a target timestamp to the nearest optimal cut point adhering to:
 * - 100ms sentence boundary tolerance
 * - >= 300ms silence gap preference
 * - Strict active speech exclusion (T not in (w.start, w.end))
 *
 * @param {number} targetTime - Proposed cut timestamp in seconds
 * @param {Object} context
 * @param {Array<Object>} [context.sentences=[]] - SentenceSegment array
 * @param {Array<Object>} [context.words=[]] - WordToken array
 * @param {Array<Object>} [context.silences=[]] - SilenceInterval array
 * @param {'start'|'end'} [context.boundaryType='start'] - Whether this is a clip start or clip end
 * @param {boolean} [context.isStart] - Alternative boolean flag for boundaryType
 * @param {number} [context.maxToleranceMs=100] - Maximum tolerance for sentence snapping in ms
 * @param {number} [context.minSilenceDuration=0.3] - Minimum silence gap duration in seconds
 * @returns {{ snappedTime: number, snappedTo: 'sentence'|'silence'|'word_boundary', gapDuration?: number, adjustedDeltaMs: number }}
 */
export function snapBoundary(targetTime, {
  sentences = [],
  words = [],
  silences = [],
  boundaryType = 'start',
  isStart,
  maxToleranceMs = DEFAULT_MAX_TOLERANCE_MS,
  minSilenceDuration = DEFAULT_MIN_SILENCE_DURATION,
} = {}) {
  const isStartBoundary = isStart !== undefined ? Boolean(isStart) : boundaryType === 'start';
  const type = isStartBoundary ? 'start' : 'end';
  const maxToleranceSec = (typeof maxToleranceMs === 'number' ? maxToleranceMs : DEFAULT_MAX_TOLERANCE_MS) / 1000.0;
  const rawTarget = typeof targetTime === 'number' && !isNaN(targetTime) ? Math.max(0, targetTime) : 0;

  // Ensure words and sentences are sorted
  const sortedWords = Array.isArray(words)
    ? words.slice().sort((a, b) => a.start - b.start)
    : [];

  const sortedSentences = Array.isArray(sentences)
    ? sentences.slice().sort((a, b) => a.start - b.start)
    : [];

  const qualifiedSilences = Array.isArray(silences)
    ? silences.filter((s) => s && s.duration >= minSilenceDuration && s.end > s.start)
    : [];

  let candidateTime = rawTarget;
  let snappedTo = 'word_boundary';
  let matchedGapDuration;

  // -------------------------------------------------------------
  // STAGE 1: Check Sentence Boundary Snapping within maxToleranceSec (100ms)
  // -------------------------------------------------------------
  let bestSentenceDiff = Infinity;
  let bestSentenceCandidate = null;

  for (const s of sortedSentences) {
    if (typeof s.start !== 'number' || typeof s.end !== 'number') continue;

    const sentencePoint = isStartBoundary ? s.start : s.end;
    const diff = Math.abs(rawTarget - sentencePoint);

    if (diff <= maxToleranceSec + 1e-6 && diff < bestSentenceDiff) {
      bestSentenceDiff = diff;
      bestSentenceCandidate = sentencePoint;
    }
  }

  if (bestSentenceCandidate !== null) {
    candidateTime = bestSentenceCandidate;
    snappedTo = 'sentence';
  }

  // -------------------------------------------------------------
  // STAGE 2: Silence Interval Snapping (>= 300ms pause)
  // If no sentence boundary matched within 100ms
  // -------------------------------------------------------------
  if (snappedTo !== 'sentence' && qualifiedSilences.length > 0) {
    // 2A: Check if rawTarget is already inside a qualified silence interval
    const containingSilence = qualifiedSilences.find(
      (sil) => rawTarget >= sil.start && rawTarget <= sil.end
    );

    if (containingSilence) {
      matchedGapDuration = containingSilence.duration;
      snappedTo = 'silence';

      if (isStartBoundary) {
        // Clip start: place near the end of silence (just before speech starts)
        const targetInSilence = Math.max(containingSilence.start, containingSilence.end - DEFAULT_SAFETY_PADDING_SEC);
        candidateTime = targetInSilence;
      } else {
        // Clip end: place near the start of silence (just after speech ends)
        const targetInSilence = Math.min(containingSilence.end, containingSilence.start + DEFAULT_SAFETY_PADDING_SEC);
        candidateTime = targetInSilence;
      }
    } else {
      // 2B: Check if nearest silence interval boundary is within maxToleranceSec
      let bestSilDiff = Infinity;
      let bestSilCandidate = null;
      let bestSilGap = null;

      for (const sil of qualifiedSilences) {
        const edgePoint = isStartBoundary ? sil.end : sil.start;
        const diff = Math.abs(rawTarget - edgePoint);

        if (diff <= maxToleranceSec && diff < bestSilDiff) {
          bestSilDiff = diff;
          bestSilCandidate = edgePoint;
          bestSilGap = sil.duration;
        }
      }

      if (bestSilCandidate !== null) {
        candidateTime = bestSilCandidate;
        snappedTo = 'silence';
        matchedGapDuration = bestSilGap;
      }
    }
  }

  // -------------------------------------------------------------
  // STAGE 3: Word Boundary Fallback
  // If neither sentence nor silence matched within tolerance
  // -------------------------------------------------------------
  if (snappedTo === 'word_boundary' && sortedWords.length > 0) {
    // Check if rawTarget collides with a word
    const collision = checkSpeechCollision(candidateTime, sortedWords);
    if (collision.collides && collision.conflictingWord) {
      const cw = collision.conflictingWord;
      candidateTime = isStartBoundary ? cw.start : cw.end;
    } else {
      // Find closest word boundary
      let minWordDist = Infinity;
      let bestWordEdge = candidateTime;

      for (const w of sortedWords) {
        const distStart = Math.abs(rawTarget - w.start);
        const distEnd = Math.abs(rawTarget - w.end);

        if (distStart < minWordDist) {
          minWordDist = distStart;
          bestWordEdge = w.start;
        }
        if (distEnd < minWordDist) {
          minWordDist = distEnd;
          bestWordEdge = w.end;
        }
      }

      if (minWordDist <= maxToleranceSec) {
        candidateTime = bestWordEdge;
      }
    }
  }

  // -------------------------------------------------------------
  // STAGE 4: STRICT ACTIVE SPEECH PROTECTION INVARIANT ENFORCEMENT (F5)
  // For all w in words: candidateTime not in (w.start, w.end)
  // -------------------------------------------------------------
  // Use consistent rounding: floor for start, ceil for end (both to 3dp)
  let snappedTime = isStartBoundary
    ? parseFloat((Math.floor(candidateTime * 1000) / 1000).toFixed(3))
    : parseFloat((Math.ceil(candidateTime * 1000) / 1000).toFixed(3));

  if (snappedTime < 0) snappedTime = 0;

  const maxIterations = sortedWords.length * 2 + 10;
  let iterations = 0;

  while (iterations < maxIterations) {
    const col = checkSpeechCollision(snappedTime, sortedWords, 1e-6);
    if (!col.collides || !col.conflictingWord) break;

    const cw = col.conflictingWord;
    if (isStartBoundary) {
      snappedTime = parseFloat((Math.floor(cw.start * 1000) / 1000).toFixed(3));
      if (snappedTime < 0) snappedTime = 0;
    } else {
      snappedTime = parseFloat((Math.ceil(cw.end * 1000) / 1000).toFixed(3));
    }
    snappedTo = 'word_boundary';
    iterations++;
  }

  // STAGE 5: RE-SNAP to sentence/silence boundary after collision resolution
  // This ensures we don't land in the middle of a word but still prefer semantic boundaries
  if (snappedTo === 'word_boundary') {
    // Try sentence boundary within tolerance
    let bestSentenceDiff = Infinity;
    let bestSentenceCandidate = null;
    for (const s of sortedSentences) {
      if (typeof s.start !== 'number' || typeof s.end !== 'number') continue;
      const sentencePoint = isStartBoundary ? s.start : s.end;
      const diff = Math.abs(snappedTime - sentencePoint);
      if (diff <= maxToleranceSec + 1e-6 && diff < bestSentenceDiff) {
        bestSentenceDiff = diff;
        bestSentenceCandidate = sentencePoint;
      }
    }
    if (bestSentenceCandidate !== null) {
      snappedTime = bestSentenceCandidate;
      snappedTo = 'sentence';
    } else if (qualifiedSilences.length > 0) {
      // Try silence boundary within tolerance
      let bestSilDiff = Infinity;
      let bestSilCandidate = null;
      for (const sil of qualifiedSilences) {
        const edgePoint = isStartBoundary ? sil.end : sil.start;
        const diff = Math.abs(snappedTime - edgePoint);
        if (diff <= maxToleranceSec + 1e-6 && diff < bestSilDiff) {
          bestSilDiff = diff;
          bestSilCandidate = edgePoint;
        }
      }
      if (bestSilCandidate !== null) {
        snappedTime = bestSilCandidate;
        snappedTo = 'silence';
      }
    }
  }

  const adjustedDeltaMs = parseFloat((Math.abs(snappedTime - rawTarget) * 1000).toFixed(1));

  return {
    snappedTime,
    snappedTo,
    ...(typeof matchedGapDuration === 'number' ? { gapDuration: parseFloat(matchedGapDuration.toFixed(3)) } : {}),
    adjustedDeltaMs,
  };
}

/**
 * Snaps both start and end boundaries of a clip recommendation object.
 *
 * @param {Object} clip - Object containing `start` and `end` timestamps
 * @param {Object} context - Context object with sentences, words, silences
 * @returns {Object} Snapped clip object with original metadata preserved
 */
export function snapClipBoundaries(clip, context = {}) {
  if (!clip || typeof clip !== 'object') {
    return clip;
  }
  if (typeof clip.start !== 'number' || typeof clip.end !== 'number' || isNaN(clip.start) || isNaN(clip.end)) {
    return clip;
  }
  if (clip.end <= clip.start) {
    throw new Error(`Invalid clip boundaries: clip.end (${clip.end}) must be greater than clip.start (${clip.start})`);
  }

  const qualifiedSilences = Array.isArray(context.silences)
    ? context.silences.filter((s) => s && s.duration >= (context.minSilenceDuration || DEFAULT_MIN_SILENCE_DURATION) && s.end > s.start)
    : [];

  // Check if both start and end fall inside the exact same qualified silence interval
  const sameSilence = qualifiedSilences.find(
    (sil) => clip.start >= sil.start && clip.start <= sil.end && clip.end >= sil.start && clip.end <= sil.end
  );

  let startSnap;
  let endSnap;

  if (sameSilence) {
    const maxToleranceSec = (typeof context.maxToleranceMs === 'number' ? context.maxToleranceMs : DEFAULT_MAX_TOLERANCE_MS) / 1000.0;
    const sortedSentences = Array.isArray(context.sentences)
      ? context.sentences.slice().sort((a, b) => a.start - b.start)
      : [];

    let startSentencePoint = null;
    let endSentencePoint = null;

    for (const s of sortedSentences) {
      if (typeof s.start === 'number' && Math.abs(clip.start - s.start) <= maxToleranceSec + 1e-6) {
        startSentencePoint = s.start;
      }
      if (typeof s.end === 'number' && Math.abs(clip.end - s.end) <= maxToleranceSec + 1e-6) {
        endSentencePoint = s.end;
      }
    }

    if (startSentencePoint !== null && endSentencePoint !== null && endSentencePoint > startSentencePoint) {
      startSnap = {
        snappedTime: parseFloat(startSentencePoint.toFixed(3)),
        snappedTo: 'sentence',
        adjustedDeltaMs: parseFloat((Math.abs(startSentencePoint - clip.start) * 1000).toFixed(1)),
      };
      endSnap = {
        snappedTime: parseFloat(endSentencePoint.toFixed(3)),
        snappedTo: 'sentence',
        adjustedDeltaMs: parseFloat((Math.abs(endSentencePoint - clip.end) * 1000).toFixed(1)),
      };
    } else {
      const safeStart = Math.max(sameSilence.start, clip.start);
      const safeEnd = Math.min(sameSilence.end, clip.end);
      const finalStart = safeEnd > safeStart ? safeStart : sameSilence.start;
      const finalEnd = safeEnd > safeStart ? safeEnd : sameSilence.end;

      startSnap = {
        snappedTime: parseFloat(finalStart.toFixed(3)),
        snappedTo: 'silence',
        gapDuration: parseFloat(sameSilence.duration.toFixed(3)),
        adjustedDeltaMs: parseFloat((Math.abs(finalStart - clip.start) * 1000).toFixed(1)),
      };
      endSnap = {
        snappedTime: parseFloat(finalEnd.toFixed(3)),
        snappedTo: 'silence',
        gapDuration: parseFloat(sameSilence.duration.toFixed(3)),
        adjustedDeltaMs: parseFloat((Math.abs(finalEnd - clip.end) * 1000).toFixed(1)),
      };
    }
  } else {
    startSnap = snapBoundary(clip.start, {
      ...context,
      boundaryType: 'start',
    });

    endSnap = snapBoundary(clip.end, {
      ...context,
      boundaryType: 'end',
    });
  }

  let finalStart = startSnap.snappedTime;
  let finalEnd = endSnap.snappedTime;

  // Tier 3: Guard against crossing caused by independent snapping
  if (finalEnd <= finalStart) {
    const sortedWords = Array.isArray(context.words)
      ? context.words.slice().sort((a, b) => a.start - b.start)
      : [];

    let recoveredStart = clip.start;
    let recoveredEnd = clip.end;

    const colStart = checkSpeechCollision(recoveredStart, sortedWords);
    if (colStart.collides && colStart.conflictingWord) {
      recoveredStart = colStart.conflictingWord.start;
    }

    const colEnd = checkSpeechCollision(recoveredEnd, sortedWords);
    if (colEnd.collides && colEnd.conflictingWord) {
      recoveredEnd = colEnd.conflictingWord.end;
    }

    const minClipDuration = context.minClipDuration || 0.060;
    if (recoveredEnd <= recoveredStart) {
      recoveredEnd = parseFloat((recoveredStart + minClipDuration).toFixed(3));
    }

    finalStart = parseFloat(recoveredStart.toFixed(3));
    finalEnd = parseFloat(recoveredEnd.toFixed(3));

    startSnap = {
      snappedTime: finalStart,
      snappedTo: colStart.collides ? 'word_boundary' : 'raw_fallback',
      adjustedDeltaMs: parseFloat((Math.abs(finalStart - clip.start) * 1000).toFixed(1)),
    };
    endSnap = {
      snappedTime: finalEnd,
      snappedTo: colEnd.collides ? 'word_boundary' : 'raw_fallback',
      adjustedDeltaMs: parseFloat((Math.abs(finalEnd - clip.end) * 1000).toFixed(1)),
    };
  }

  return {
    ...clip,
    start: finalStart,
    end: finalEnd,
    snappingDetails: {
      start: startSnap,
      end: endSnap,
    },
  };
}

export default snapBoundary;
