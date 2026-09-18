// tests/unit/f3_silence.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import {
  detectAcousticSilence,
  detectLinguisticSilence,
  mergeSilenceIntervals,
  detectSilence,
} from '../../utils/silenceDetector.js';
import {
  standardWords,
  emptyWords,
  continuousWords,
} from '../fixtures/mockTranscripts.js';

/**
 * Feature F3: Dual-Layer Silence Detection
 * Requirement: ORIGINAL_REQUEST §R1, PROJECT.md F3
 *
 * Invariant:
 * Detects both acoustic silence via FFmpeg (noise=-30dB:d=0.3)
 * and linguistic word gaps (>=300ms) and merges them into a sorted,
 * non-overlapping array of SilenceIntervals.
 */

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const SILENCE_AUDIO_PATH = path.join(FIXTURES_DIR, 'sample_silence_audio.wav');

test('Tier 1: F3 - Dual-Layer Silence Detection', async (t) => {
  await t.test('Case 1: detectLinguisticSilence detects inter-word gaps >= 300ms', () => {
    // standardWords has pauses at 2.40-3.10 (700ms) and 4.70-5.40 (700ms)
    const silences = detectLinguisticSilence(standardWords);
    assert.ok(Array.isArray(silences));
    assert.ok(silences.length >= 2, `Expected at least 2 silences, got ${silences.length}`);

    const gap1 = silences.find((s) => s.start >= 2.3 && s.end <= 3.2);
    assert.ok(gap1, 'Should find gap around 2.40s - 3.10s');
    assert.ok(gap1.duration >= 0.3, `Gap duration ${gap1.duration} must be >= 0.3s`);

    const gap2 = silences.find((s) => s.start >= 4.6 && s.end <= 5.5);
    assert.ok(gap2, 'Should find gap around 4.70s - 5.40s');
    assert.ok(gap2.duration >= 0.3, `Gap duration ${gap2.duration} must be >= 0.3s`);
  });

  await t.test('Case 2: detectLinguisticSilence detects lead-in silence (0 to first word)', () => {
    // standardWords starts at 1.00s -> lead-in silence is 0 to 1.00s (duration 1.00s)
    const silences = detectLinguisticSilence(standardWords);
    const leadIn = silences.find((s) => s.start === 0);
    assert.ok(leadIn, 'Should identify lead-in silence starting at 0');
    assert.strictEqual(leadIn.end, 1.00);
    assert.strictEqual(leadIn.duration, 1.00);
  });

  await t.test('Case 3: detectLinguisticSilence detects trailing silence when totalDuration provided', () => {
    // standardWords ends at 6.80s, totalDuration = 10.0s -> trailing silence 6.80 to 10.00s
    const silences = detectLinguisticSilence(standardWords, { totalDuration: 10.0 });
    const trailing = silences.find((s) => s.end === 10.0);
    assert.ok(trailing, 'Should identify trailing silence ending at 10.0s');
    assert.strictEqual(trailing.start, 6.80);
    assert.strictEqual(trailing.duration, 3.20);
  });

  await t.test('Case 4: mergeSilenceIntervals merges overlapping intervals cleanly', () => {
    const acoustic = [
      { start: 2.35, end: 3.15, duration: 0.8, source: 'acoustic' },
    ];
    const linguistic = [
      { start: 2.40, end: 3.10, duration: 0.7, source: 'linguistic' },
    ];
    const merged = mergeSilenceIntervals(acoustic, linguistic);
    assert.strictEqual(merged.length, 1, 'Should merge overlapping intervals into single interval');
    assert.strictEqual(merged[0].start, 2.35);
    assert.strictEqual(merged[0].end, 3.15);
    assert.strictEqual(merged[0].source, 'hybrid');
  });

  await t.test('Case 5: detectAcousticSilence extracts real acoustic silence from media file', async () => {
    const silences = await detectAcousticSilence(SILENCE_AUDIO_PATH);
    assert.ok(Array.isArray(silences));
    assert.ok(silences.length >= 2, `Expected at least 2 acoustic silences in sample audio, got ${silences.length}`);

    // The sample_silence_audio has 2s tone, 1s silence, 2s tone, 1s silence
    for (const sil of silences) {
      assert.strictEqual(sil.source, 'acoustic');
      assert.ok(sil.duration >= 0.3, `Duration ${sil.duration} must be >= 0.3s`);
    }
  });
});

test('Tier 2: F3 - Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Continuous speech with zero pauses produces zero linguistic silences', () => {
    // continuousWords has 0ms pause between consecutive words, starts at 0.0s
    const silences = detectLinguisticSilence(continuousWords);
    assert.strictEqual(silences.length, 0, 'Continuous speech without gaps should have 0 silences');
  });

  await t.test('Case 2: Short inter-word gaps (<300ms) are strictly ignored', () => {
    const microPauseWords = [
      { word: 'Hello', start: 0.0, end: 0.4 },
      // 100ms pause (0.4 to 0.5)
      { word: 'world', start: 0.5, end: 0.9 },
      // 250ms pause (0.9 to 1.15)
      { word: 'again', start: 1.15, end: 1.5 },
    ];
    const silences = detectLinguisticSilence(microPauseWords, { minDuration: 0.3 });
    assert.strictEqual(silences.length, 0, 'Gaps under 300ms must not be counted as silence intervals');
  });

  await t.test('Case 3: Empty words array returns empty silence list', () => {
    const silences = detectLinguisticSilence(emptyWords);
    assert.deepStrictEqual(silences, []);
  });

  await t.test('Case 4: Non-existent audio file returns empty acoustic silence list without throwing', async () => {
    const silences = await detectAcousticSilence('non_existent_file_path_12345.wav');
    assert.deepStrictEqual(silences, []);
  });

  await t.test('Case 5: detectSilence unifies acoustic and linguistic layers', async () => {
    const silences = await detectSilence({ audioPath: SILENCE_AUDIO_PATH, words: standardWords });
    assert.ok(Array.isArray(silences));
    assert.ok(silences.length > 0);

    // Verify all intervals are sorted chronologically
    for (let i = 0; i < silences.length - 1; i++) {
      assert.ok(silences[i + 1].start >= silences[i].end, 'Intervals must be non-overlapping and sorted');
    }
  });
});
