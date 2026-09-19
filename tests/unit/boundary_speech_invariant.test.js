// tests/unit/boundary_speech_invariant.test.js
import test from 'node:test';
import assert from 'node:assert';

import { snapBoundary, checkSpeechCollision, snapClipBoundaries } from '../../utils/boundarySnapper.js';

/**
 * Regression: the "no cut inside a spoken word" invariant (audit finding H3).
 *
 * Requirement F5 states: for all words w, the snapped time must NOT fall inside
 * (w.start, w.end). STAGE 4 of snapBoundary enforces this, but STAGE 5 then
 * restores a semantic (sentence/silence) boundary chosen from the RAW target and
 * could move the cut straight back inside a word — silently voiding the
 * guarantee that had just been established.
 *
 * This is realistic: sentence boundaries come from LLM segmentation while word
 * tokens come from ASR. The two disagree, and a sentence start can legitimately
 * land inside a word token. Verified before the fix (sentence start 5.0s, word
 * spanning 4.5-5.5s):
 *
 *   target=5.00 -> snapped=5.00 to=sentence  collides=TRUE (inside "SPANNING")
 *   target=5.05 -> snapped=5.00 to=sentence  collides=TRUE
 *   target=4.98 -> snapped=5.00 to=sentence  collides=TRUE
 */

const SENTENCES = [
  { start: 0.0, end: 1.0, text: 'hello' },
  { start: 5.0, end: 6.0, text: 'world' },
];

// The second sentence begins at 5.0s, which is INSIDE this word token.
const WORDS = [
  { word: 'hello', start: 0.0, end: 1.0 },
  { word: 'SPANNING', start: 4.5, end: 5.5 },
  { word: 'world', start: 5.6, end: 6.2 },
];

test('Boundary snapping: sentence restore may not break the speech invariant (H3)', async (t) => {
  await t.test('Case 1: a sentence boundary inside a word does not win', () => {
    const result = snapBoundary(5.0, {
      sentences: SENTENCES,
      words: WORDS,
      silences: [],
      boundaryType: 'start',
    });

    const collision = checkSpeechCollision(result.snappedTime, WORDS);
    assert.strictEqual(
      collision.collides,
      false,
      `snapped ${result.snappedTime} lands inside "${collision.conflictingWord?.word}"`
    );
  });

  await t.test('Case 2: every nearby target resolves collision-free', () => {
    for (const target of [4.6, 4.9, 4.98, 5.0, 5.05, 5.4]) {
      const result = snapBoundary(target, {
        sentences: SENTENCES,
        words: WORDS,
        silences: [],
        boundaryType: 'start',
      });
      const collision = checkSpeechCollision(result.snappedTime, WORDS);
      assert.strictEqual(
        collision.collides,
        false,
        `target ${target} -> snapped ${result.snappedTime} inside "${collision.conflictingWord?.word}"`
      );
    }
  });

  await t.test('Case 3: the invariant also holds for end boundaries', () => {
    // Mirror the situation for a clip END: the sentence point sits inside a word.
    const sentences = [{ start: 3.0, end: 4.0, text: 'a' }, { start: 4.0, end: 8.0, text: 'b' }];
    const words = [
      { word: 'alpha', start: 3.0, end: 4.2 },
      { word: 'MIDDLE', start: 4.0, end: 6.0 },
      { word: 'omega', start: 6.0, end: 8.0 },
    ];

    for (const target of [3.9, 4.0, 4.1, 6.0]) {
      const result = snapBoundary(target, {
        sentences, words, silences: [], boundaryType: 'end',
      });
      const collision = checkSpeechCollision(result.snappedTime, words);
      assert.strictEqual(
        collision.collides,
        false,
        `end target ${target} -> snapped ${result.snappedTime} inside "${collision.conflictingWord?.word}"`
      );
    }
  });

  await t.test('Case 4: a clean sentence boundary is still honoured', () => {
    // When the sentence boundary does NOT sit inside any word, semantic snapping
    // must still win — the fix must not disable legitimate snapping.
    const sentences = [{ start: 2.0, end: 3.0, text: 'ok' }, { start: 10.0, end: 11.0, text: 'next' }];
    const words = [
      { word: 'first', start: 1.6, end: 2.0 },
      { word: 'second', start: 3.0, end: 3.6 },
    ];
    const result = snapBoundary(2.0, { sentences, words, silences: [], boundaryType: 'start' });
    assert.strictEqual(result.snappedTime, 2.0);
    assert.strictEqual(result.snappedTo, 'sentence');
  });

  await t.test('Case 5: snapClipBoundaries never returns a mid-word boundary', () => {
    const clip = { start: 5.0, end: 11.5 };
    const words = [
      { word: 'warmup', start: 4.0, end: 5.5 },
      { word: 'TALKING', start: 5.6, end: 8.0 },
      { word: 'closing', start: 9.0, end: 11.5 },
      { word: 'TAIL', start: 11.0, end: 12.5 },
    ];
    const snapped = snapClipBoundaries(clip, { sentences: SENTENCES, words, silences: [] });

    assert.strictEqual(
      checkSpeechCollision(snapped.start, words).collides,
      false,
      `clip start ${snapped.start} is inside a word`
    );
    assert.strictEqual(
      checkSpeechCollision(snapped.end, words).collides,
      false,
      `clip end ${snapped.end} is inside a word`
    );
  });

  await t.test('Case 6: the invariant holds with no sentences at all', () => {
    const result = snapBoundary(5.0, { sentences: [], words: WORDS, silences: [], boundaryType: 'start' });
    assert.strictEqual(checkSpeechCollision(result.snappedTime, WORDS).collides, false);
  });
});
