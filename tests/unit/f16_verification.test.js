// tests/unit/f16_verification.test.js
import test from 'node:test';
import assert from 'node:assert';
import { checkSpeechCollision } from '../../utils/boundarySnapper.js';
import { validateNarrativeClipSchema, mockQuestionClip } from '../fixtures/mockNarratives.js';
import { standardWords } from '../fixtures/mockTranscripts.js';

/**
 * Feature F16: Automated Verification Test Suite
 * Requirements: ORIGINAL_REQUEST §R4, Acceptance Criteria, PROJECT.md F16
 *
 * Invariant:
 *  - Automated boundary test confirms start/end snap to <= 100ms of sentence or silence (>300ms).
 *  - No clip cuts off in the middle of a spoken word.
 *  - Every clip includes valid hook, narrative rationale, virality score, and discrete sentence IDs.
 *  - Framing transitions smoothly without 1-frame snapping artifacts.
 *  - Output video streams produce valid 9:16 (1080x1920) render outputs with duration > 0.
 *  - Zero unhandled promise rejections or crashes.
 */

/**
 * Validator function for Acceptance Criterion: Audio & Boundary Precision
 * @param {Array<{ start: number, end: number }>} clips
 * @param {Array<Object>} sentences
 * @param {Array<Object>} silences
 * @param {Array<Object>} words
 * @returns {{ passed: boolean, failures: Array<string> }}
 */
export function verifyBoundaryPrecision(clips, sentences, silences, words) {
  const failures = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];

    // Check 1: Start boundary within 100ms of a sentence boundary or inside silence >=300ms
    const nearSentenceStart = sentences.some((s) => Math.abs(clip.start - s.start) <= 0.1001 || Math.abs(clip.start - s.end) <= 0.1001);
    const inSilenceStart = silences.some((sil) => sil.duration >= 0.3 && clip.start >= sil.start - 0.05 && clip.start <= sil.end + 0.05);

    if (!nearSentenceStart && !inSilenceStart) {
      failures.push(`Clip ${i + 1} start (${clip.start}s) is not within 100ms of a sentence boundary or silence gap`);
    }

    // Check 2: End boundary within 100ms of a sentence boundary or inside silence >=300ms
    const nearSentenceEnd = sentences.some((s) => Math.abs(clip.end - s.start) <= 0.1001 || Math.abs(clip.end - s.end) <= 0.1001);
    const inSilenceEnd = silences.some((sil) => sil.duration >= 0.3 && clip.end >= sil.start - 0.05 && clip.end <= sil.end + 0.05);

    if (!nearSentenceEnd && !inSilenceEnd) {
      failures.push(`Clip ${i + 1} end (${clip.end}s) is not within 100ms of a sentence boundary or silence gap`);
    }

    // Check 3: Active Speech Protection - zero cuts during spoken words
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

/**
 * Validator function for Acceptance Criterion: Camera Framing Smoothness
 * @param {Array<{ deltaX: number }>} sampledFrames
 * @param {number} [maxAllowedDelta=25]
 * @returns {{ passed: boolean, maxDelta: number }}
 */
export function verifyCameraFramingSmoothness(sampledFrames, maxAllowedDelta = 25) {
  const maxDelta = Math.max(0, ...sampledFrames.map((f) => f.deltaX || 0));
  return {
    passed: maxDelta <= maxAllowedDelta,
    maxDelta,
  };
}

/**
 * Validator function for Acceptance Criterion: Output Video 9:16 Conformance
 * @param {{ width?: number, height?: number, duration?: number }} probeResult
 * @returns {{ passed: boolean, errors: Array<string> }}
 */
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

test('Tier 1: F16 - Automated Verification Test Suite', async (t) => {
  await t.test('Case 1: verifyBoundaryPrecision validates pre-snapped clip start and end boundaries', () => {
    const mockSentences = [
      { id: 's1', start: 1.00, end: 2.40 },
      { id: 's2', start: 3.10, end: 4.70 },
    ];
    const mockSilences = [{ start: 2.40, end: 3.10, duration: 0.70 }];
    const validClips = [{ start: 1.00, end: 4.70 }];

    const result = verifyBoundaryPrecision(validClips, mockSentences, mockSilences, standardWords);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.failures.length, 0);
  });

  await t.test('Case 2: verifyBoundaryPrecision flags cuts occurring inside active spoken words', () => {
    const mockSentences = [{ id: 's1', start: 1.00, end: 2.40 }];
    // "Welcome" is [1.00s, 1.40s]. Cut at 1.20s is inside active speech.
    const badClips = [{ start: 1.20, end: 2.40 }];

    const result = verifyBoundaryPrecision(badClips, mockSentences, [], standardWords);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some((f) => f.includes('cuts during word "Welcome"')));
  });

  await t.test('Case 3: validateNarrativeClipSchema verifies all mandatory narrative and hook fields', () => {
    const result = validateNarrativeClipSchema(mockQuestionClip);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  await t.test('Case 4: verifyCameraFramingSmoothness passes smooth velocity (<25px/frame)', () => {
    const smoothFrames = [
      { frame: 1, deltaX: 2.5 },
      { frame: 2, deltaX: 12.0 },
      { frame: 3, deltaX: 21.0 },
      { frame: 4, deltaX: 14.0 },
      { frame: 5, deltaX: 3.0 },
    ];
    const result = verifyCameraFramingSmoothness(smoothFrames, 25);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.maxDelta, 21.0);
  });

  await t.test('Case 5: verifyVideoConformance passes 1080x1920 video with duration > 0', () => {
    const validProbe = { width: 1080, height: 1920, duration: 15.4 };
    const result = verifyVideoConformance(validProbe);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.errors.length, 0);
  });
});

test('Tier 2: F16 - Verification Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Camera framing velocity flags 1-frame coordinate snap (>25px/frame)', () => {
    const snappingFrames = [
      { frame: 1, deltaX: 0 },
      { frame: 2, deltaX: 520.0 }, // 1-frame snap
      { frame: 3, deltaX: 0 },
    ];
    const result = verifyCameraFramingSmoothness(snappingFrames, 25);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.maxDelta, 520.0);
  });

  await t.test('Case 2: verifyVideoConformance flags incorrect aspect ratios or dimensions', () => {
    const badProbe = { width: 1920, height: 1080, duration: 10.0 }; // 16:9 instead of 9:16
    const result = verifyVideoConformance(badProbe);
    assert.strictEqual(result.passed, false);
    assert.ok(result.errors.some((e) => e.includes('1080')));
    assert.ok(result.errors.some((e) => e.includes('1920')));
  });

  await t.test('Case 3: verifyVideoConformance flags zero or negative video duration', () => {
    const zeroDurProbe = { width: 1080, height: 1920, duration: 0 };
    const result = verifyVideoConformance(zeroDurProbe);
    assert.strictEqual(result.passed, false);
    assert.ok(result.errors.some((e) => e.includes('duration')));
  });

  await t.test('Case 4: Empty clips array passes boundary precision verification trivially', () => {
    const result = verifyBoundaryPrecision([], [], [], []);
    assert.strictEqual(result.passed, true);
  });

  await t.test('Case 5: Null probe result handled gracefully with error array', () => {
    const result = verifyVideoConformance(null);
    assert.strictEqual(result.passed, false);
    assert.ok(result.errors.length > 0);
  });
});
