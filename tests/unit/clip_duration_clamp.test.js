// tests/unit/clip_duration_clamp.test.js
/**
 * Regression: clip duration clamp must actually be APPLIED.
 *
 * Real defect found in production logs: the AI returned a 319-second clip
 * (5+ minutes) for a Shorts pipeline despite a documented 90s maximum.
 *
 * Root cause: resolveSentenceIds() correctly computed the clamped end time
 * into `snappedEnd`, but the return statement read `endSnap.snappedTime`
 * (the ORIGINAL, un-clamped object), silently discarding the clamp.
 */
import test from 'node:test';
import assert from 'node:assert';
import { resolveSentenceIds } from '../../utils/analyzer.js';
import { buildSentenceMap } from '../../utils/sentenceSegmenter.js';

function makeSentences(count, startTime, durationEach) {
  const list = [];
  let t = startTime;
  for (let i = 0; i < count; i++) {
    const index = 100 + i;
    list.push({ index, id: `s${index}`, start: t, end: t + durationEach, text: `Sentence ${index}` });
    t += durationEach;
  }
  return list;
}

test('Clip duration clamp', async (t) => {
  await t.test('clamps an over-long clip to the maximum duration', () => {
    // 22 sentences x 14.5s = 319s total, far beyond the 90s cap.
    const sentences = makeSentences(22, 1555.2, 14.5);
    const map = buildSentenceMap(sentences);

    const resolved = resolveSentenceIds(
      { startSentenceId: 's100', endSentenceId: 's121' },
      map,
      { sentences, words: [], silences: [], language: 'en' }
    );

    const duration = resolved.end - resolved.start;
    assert.ok(
      duration <= 90,
      `Clamped duration must be <= 90s, got ${duration.toFixed(1)}s`
    );
    assert.ok(duration >= 30, `Clamped clip must still be usable, got ${duration.toFixed(1)}s`);
  });

  await t.test('leaves a compliant clip untouched', () => {
    // 5 sentences x 12s = 60s, already within bounds.
    const sentences = makeSentences(5, 100, 12);
    const map = buildSentenceMap(sentences);

    const resolved = resolveSentenceIds(
      { startSentenceId: 's100', endSentenceId: 's104' },
      map,
      { sentences, words: [], silences: [], language: 'en' }
    );

    const duration = resolved.end - resolved.start;
    assert.strictEqual(duration, 60, `Compliant clip must keep its duration, got ${duration}s`);
  });

  await t.test('returned end never exceeds the clamp even by a rounding hair', () => {
    const sentences = makeSentences(30, 0, 10);
    const map = buildSentenceMap(sentences);
    const resolved = resolveSentenceIds(
      { startSentenceId: 's100', endSentenceId: 's129' },
      map,
      { sentences, words: [], silences: [], language: 'en' }
    );
    assert.ok(resolved.end - resolved.start <= 90.0001, 'end - start must respect the cap');
  });
});
