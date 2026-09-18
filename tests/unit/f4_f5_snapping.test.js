// tests/unit/f4_f5_snapping.test.js
import test from 'node:test';
import assert from 'node:assert';
import {
  snapBoundary,
  snapClipBoundaries,
  checkSpeechCollision,
} from '../../utils/boundarySnapper.js';
import { segmentWordsIntoSentences } from '../../utils/sentenceSegmenter.js';
import { detectLinguisticSilence } from '../../utils/silenceDetector.js';
import {
  standardWords,
  continuousWords,
} from '../fixtures/mockTranscripts.js';

/**
 * Features F4 & F5: Boundary Snapping Engine & Active Speech Protection
 * Requirements: ORIGINAL_REQUEST §R1, AC Audio & Boundary Precision, PROJECT.md F4, F5
 *
 * Invariants:
 *  F4: Snap start & end boundaries within 100ms of sentence boundary or >300ms silence.
 *  F5: Strict Active Speech Protection: For all w in words, T_snapped not in (w.start, w.end).
 */

const sentences = segmentWordsIntoSentences(standardWords);
const silences = detectLinguisticSilence(standardWords);

test('Tier 1: F4 - Boundary Snapping Engine', async (t) => {
  await t.test('Case 1: Snaps clip start to sentence boundary when within 100ms tolerance', () => {
    // s1 starts at 1.00s. Target = 1.05s (diff = 50ms <= 100ms)
    const result = snapBoundary(1.05, { sentences, words: standardWords, silences, boundaryType: 'start' });
    assert.strictEqual(result.snappedTo, 'sentence');
    assert.ok(Math.abs(result.snappedTime - 1.00) <= 0.1, `Snapped time ${result.snappedTime} must be within 100ms of s1 start (1.00)`);
    assert.ok(result.adjustedDeltaMs <= 100, `Delta ${result.adjustedDeltaMs}ms must be <= 100ms`);
  });

  await t.test('Case 2: Snaps clip end to sentence boundary when within 100ms tolerance', () => {
    // s1 ends at 2.40s. Target = 2.35s (diff = 50ms <= 100ms)
    const result = snapBoundary(2.35, { sentences, words: standardWords, silences, boundaryType: 'end' });
    assert.strictEqual(result.snappedTo, 'sentence');
    assert.ok(Math.abs(result.snappedTime - 2.40) <= 0.1, `Snapped time ${result.snappedTime} must be within 100ms of s1 end (2.40)`);
    assert.ok(result.adjustedDeltaMs <= 100, `Delta ${result.adjustedDeltaMs}ms must be <= 100ms`);
  });

  await t.test('Case 3: Snaps clip start inside silence gap to the end of silence (just before next speech)', () => {
    // Silence exists between 2.40s and 3.10s (700ms gap). Target = 2.70s
    const result = snapBoundary(2.70, { sentences, words: standardWords, silences, boundaryType: 'start' });
    assert.strictEqual(result.snappedTo, 'silence');
    assert.ok(result.snappedTime >= 2.40 && result.snappedTime <= 3.10, 'Must snap inside silence gap');
    assert.ok(result.gapDuration >= 0.3, 'Gap duration must be >= 300ms');
  });

  await t.test('Case 4: Snaps clip end inside silence gap to the start of silence (just after speech ends)', () => {
    // Target = 2.80s inside silence [2.40s - 3.10s]
    const result = snapBoundary(2.80, { sentences, words: standardWords, silences, boundaryType: 'end' });
    assert.strictEqual(result.snappedTo, 'silence');
    assert.ok(result.snappedTime >= 2.40 && result.snappedTime <= 3.10, 'Must snap inside silence gap');
    assert.ok(result.gapDuration >= 0.3, 'Gap duration must be >= 300ms');
  });

  await t.test('Case 5: snapClipBoundaries snaps both start and end simultaneously', () => {
    const candidateClip = {
      title: 'Test Clip',
      start: 1.05,
      end: 4.65, // s2 ends at 4.70s (diff = 50ms)
    };
    const snapped = snapClipBoundaries(candidateClip, { sentences, words: standardWords, silences });
    assert.strictEqual(snapped.title, 'Test Clip');
    assert.ok(Math.abs(snapped.start - 1.00) <= 0.1, `Start ${snapped.start} must snap within 100ms of s1 start`);
    assert.ok(Math.abs(snapped.end - 4.70) <= 0.1, `End ${snapped.end} must snap within 100ms of s2 end`);
    assert.ok(snapped.snappingDetails.start);
    assert.ok(snapped.snappingDetails.end);
  });
});

test('Tier 2: F4 - Snapping Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Target timestamp before first word snaps safely to 0 or first word start', () => {
    const result = snapBoundary(0.2, { sentences, words: standardWords, silences, boundaryType: 'start' });
    assert.ok(result.snappedTime >= 0);
    // In lead-in silence [0, 1.00]
    assert.ok(result.snappedTime <= 1.00);
  });

  await t.test('Case 2: Target timestamp after last word snaps safely without out-of-bounds error', () => {
    const result = snapBoundary(12.0, { sentences, words: standardWords, silences, boundaryType: 'end' });
    assert.ok(typeof result.snappedTime === 'number');
    assert.ok(!isNaN(result.snappedTime));
  });

  await t.test('Case 3: Exact 100ms tolerance edge (<= 100ms snaps to sentence, > 100ms does not)', () => {
    // s1 starts at 1.00s. Target 1.100s has diff = 100ms -> snaps
    const snapAt100 = snapBoundary(1.100, { sentences, words: standardWords, silences, boundaryType: 'start', maxToleranceMs: 100 });
    assert.strictEqual(snapAt100.snappedTime, 1.00);

    // Target 1.150s has diff = 150ms -> does not snap to s1 start directly
    const snapAt150 = snapBoundary(1.150, { sentences, words: standardWords, silences: [], boundaryType: 'start', maxToleranceMs: 100 });
    assert.notStrictEqual(snapAt150.snappedTo, 'sentence');
  });

  await t.test('Case 4: Snapping with zero silences available falls back cleanly', () => {
    const result = snapBoundary(1.05, { sentences, words: standardWords, silences: [], boundaryType: 'start' });
    assert.strictEqual(result.snappedTime, 1.00);
  });

  await t.test('Case 5: Negative target time handled gracefully', () => {
    const result = snapBoundary(-5.0, { sentences, words: standardWords, silences, boundaryType: 'start' });
    assert.ok(result.snappedTime >= 0, 'Snapped time must not be negative');
  });
});

test('Tier 1: F5 - Active Speech Protection', async (t) => {
  await t.test('Case 1: Hard Invariant - Snapped timestamp NEVER falls inside an active spoken word', () => {
    // Test 50 candidate cut timestamps spanning the entire transcript
    for (let tSec = 0.5; tSec <= 7.0; tSec += 0.1) {
      const snapStart = snapBoundary(tSec, { sentences, words: standardWords, silences, boundaryType: 'start' });
      const snapEnd = snapBoundary(tSec, { sentences, words: standardWords, silences, boundaryType: 'end' });

      for (const w of standardWords) {
        // Strict open interval exclusion: T not in (w.start, w.end)
        const inStartWord = snapStart.snappedTime > w.start + 1e-4 && snapStart.snappedTime < w.end - 1e-4;
        const inEndWord = snapEnd.snappedTime > w.start + 1e-4 && snapEnd.snappedTime < w.end - 1e-4;

        assert.strictEqual(inStartWord, false, `Start cut at ${snapStart.snappedTime} must not be inside word "${w.word}" [${w.start}, ${w.end}]`);
        assert.strictEqual(inEndWord, false, `End cut at ${snapEnd.snappedTime} must not be inside word "${w.word}" [${w.start}, ${w.end}]`);
      }
    }
  });

  await t.test('Case 2: Start cut point in middle of word pushed to word start', () => {
    // Word "incredible" is [4.10s, 4.45s]. Target = 4.25s (dead middle of word)
    const result = snapBoundary(4.25, { sentences: [], words: standardWords, silences: [], boundaryType: 'start' });
    assert.strictEqual(result.snappedTime, 4.10, 'Start cut inside word must be pushed to word start (4.10s)');
  });

  await t.test('Case 3: End cut point in middle of word pushed to word end', () => {
    // Word "incredible" is [4.10s, 4.45s]. Target = 4.25s
    const result = snapBoundary(4.25, { sentences: [], words: standardWords, silences: [], boundaryType: 'end' });
    assert.strictEqual(result.snappedTime, 4.45, 'End cut inside word must be pushed to word end (4.45s)');
  });

  await t.test('Case 4: checkSpeechCollision correctly identifies colliding word token', () => {
    // Word "Welcome" is [1.00s, 1.40s]
    const coll1 = checkSpeechCollision(1.20, standardWords);
    assert.strictEqual(coll1.collides, true);
    assert.strictEqual(coll1.conflictingWord.word, 'Welcome');

    // Time in gap at 2.60s (between s1 and s2)
    const coll2 = checkSpeechCollision(2.60, standardWords);
    assert.strictEqual(coll2.collides, false);
    assert.strictEqual(coll2.conflictingWord, null);
  });

  await t.test('Case 5: Continuous speech stream without pauses still avoids mid-word cuts', () => {
    // In continuousWords, every word abuts the next. Target = 0.35s (inside "quick" [0.20, 0.50])
    const result = snapBoundary(0.35, { sentences: [], words: continuousWords, silences: [], boundaryType: 'start' });
    assert.strictEqual(result.snappedTime, 0.20, 'Should snap to start of "quick"');
  });
});

test('Tier 2: F5 - Active Speech Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Cut point exactly at w.start is allowed (not inside open interval)', () => {
    const coll = checkSpeechCollision(1.00, standardWords);
    assert.strictEqual(coll.collides, false, 'Boundary exactly at w.start is not a mid-word collision');
  });

  await t.test('Case 2: Cut point exactly at w.end is allowed (not inside open interval)', () => {
    const coll = checkSpeechCollision(1.40, standardWords);
    assert.strictEqual(coll.collides, false, 'Boundary exactly at w.end is not a mid-word collision');
  });

  await t.test('Case 3: Micro-words with 50ms duration strictly protected from mid-word cuts', () => {
    const microWords = [
      { word: 'A', start: 1.00, end: 1.05 },
      { word: 'B', start: 1.15, end: 1.20 },
    ];
    // Target = 1.025 (dead center of 50ms word)
    const startSnap = snapBoundary(1.025, { sentences: [], words: microWords, silences: [], boundaryType: 'start' });
    assert.strictEqual(startSnap.snappedTime, 1.00);

    const endSnap = snapBoundary(1.025, { sentences: [], words: microWords, silences: [], boundaryType: 'end' });
    assert.strictEqual(endSnap.snappedTime, 1.05);
  });

  await t.test('Case 4: Empty words array does not collide or throw', () => {
    const coll = checkSpeechCollision(1.5, []);
    assert.strictEqual(coll.collides, false);
    assert.strictEqual(coll.conflictingWord, null);
  });

  await t.test('Case 5: Overlapping words protect both intervals', () => {
    const overlap = [
      { word: 'Left', start: 1.0, end: 1.8 },
      { word: 'Right', start: 1.5, end: 2.2 },
    ];
    // Target = 1.6 (inside both words)
    const coll = checkSpeechCollision(1.6, overlap);
    assert.strictEqual(coll.collides, true);
  });
});
