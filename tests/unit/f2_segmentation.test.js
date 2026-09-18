// tests/unit/f2_segmentation.test.js
import test from 'node:test';
import assert from 'node:assert';
import {
  segmentWordsIntoSentences,
  buildSentenceMap,
  findSentenceAtTime,
} from '../../utils/sentenceSegmenter.js';
import {
  standardWords,
  emptyWords,
  singleWordList,
  longPauseWords,
  abbreviationWords,
  overlappingWords,
} from '../fixtures/mockTranscripts.js';

/**
 * Feature F2: Discrete Sentence Segmentation
 * Requirement: ORIGINAL_REQUEST §R1, PROJECT.md F2
 *
 * Invariant:
 * Segments words into grammatical sentences (s1, s2... sN) based on:
 * - Terminal punctuation (. ? ! …)
 * - Natural pause intervals (>=0.8s)
 * - Speaker turns
 * - Maximum duration guards
 */

test('Tier 1: F2 - Discrete Sentence Segmentation', async (t) => {
  await t.test('Case 1: Terminal punctuation splits words into sentences', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    assert.strictEqual(sentences.length, 3, 'Should produce exactly 3 sentences');
    assert.strictEqual(sentences[0].id, 's1');
    assert.strictEqual(sentences[1].id, 's2');
    assert.strictEqual(sentences[2].id, 's3');
    assert.strictEqual(sentences[0].text, 'Welcome to our podcast.');
    assert.strictEqual(sentences[1].text, 'Today we have an incredible guest.');
    assert.strictEqual(sentences[2].text, 'Tell us your secret story.');
  });

  await t.test('Case 2: Inter-word pauses (>=0.8s) trigger sentence boundaries', () => {
    const wordsWithPause = [
      { word: 'First', start: 1.0, end: 1.4 },
      { word: 'clause', start: 1.5, end: 1.8 },
      // 0.9s pause (1.8s to 2.7s), no punctuation
      { word: 'second', start: 2.7, end: 3.0 },
      { word: 'clause', start: 3.1, end: 3.5 },
    ];
    const sentences = segmentWordsIntoSentences(wordsWithPause, { minPauseThreshold: 0.8 });
    assert.strictEqual(sentences.length, 2, 'Pause >= 0.8s should trigger sentence boundary');
    assert.strictEqual(sentences[0].text, 'First clause');
    assert.strictEqual(sentences[1].text, 'second clause');
  });

  await t.test('Case 3: Speaker turn transitions trigger sentence boundaries', () => {
    const dialogueWords = [
      { word: 'Are', start: 1.0, end: 1.2, speaker: 'Alice' },
      { word: 'you', start: 1.25, end: 1.4, speaker: 'Alice' },
      { word: 'ready', start: 1.45, end: 1.7, speaker: 'Alice' },
      { word: 'Yes', start: 1.8, end: 2.0, speaker: 'Bob' },
      { word: 'I', start: 2.05, end: 2.15, speaker: 'Bob' },
      { word: 'am.', start: 2.2, end: 2.5, speaker: 'Bob' },
    ];
    const sentences = segmentWordsIntoSentences(dialogueWords);
    assert.strictEqual(sentences.length, 2, 'Speaker switch should trigger sentence boundary');
    assert.strictEqual(sentences[0].speaker, 'Alice');
    assert.strictEqual(sentences[1].speaker, 'Bob');
  });

  await t.test('Case 4: Sequential sentence IDs and correct start/end timestamps', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      assert.strictEqual(s.id, `s${i + 1}`);
      assert.strictEqual(s.index, i);
      assert.ok(s.end > s.start, `Sentence ${s.id} end (${s.end}) must be > start (${s.start})`);
      assert.strictEqual(s.start, s.words[0].start);
      assert.strictEqual(s.end, s.words[s.words.length - 1].end);
    }
  });

  await t.test('Case 5: buildSentenceMap creates accurate O(1) lookup map', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    const map = buildSentenceMap(sentences);
    assert.strictEqual(map.size, 3);
    assert.ok(map.has('s1'));
    assert.ok(map.has('s2'));
    assert.ok(map.has('s3'));
    assert.strictEqual(map.get('s1').text, 'Welcome to our podcast.');
  });
});

test('Tier 2: F2 - Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Abbreviations and decimal numbers do not trigger false sentence splits', () => {
    const sentences = segmentWordsIntoSentences(abbreviationWords);
    // "Dr. Smith visited the U.S. at 3.14 PM. It was great."
    // Sentence 1 should end at "PM." and sentence 2 at "great."
    assert.strictEqual(sentences.length, 2, 'Abbreviations Dr., U.S., 3.14 should not split early');
    assert.ok(sentences[0].text.includes('Dr. Smith visited the U.S. at 3.14 PM.'));
    assert.ok(sentences[1].text.includes('It was great.'));
  });

  await t.test('Case 2: Empty words array returns empty sentences array', () => {
    const sentences = segmentWordsIntoSentences(emptyWords);
    assert.deepStrictEqual(sentences, []);
  });

  await t.test('Case 3: Single word input produces single sentence with id s1', () => {
    const sentences = segmentWordsIntoSentences(singleWordList);
    assert.strictEqual(sentences.length, 1);
    assert.strictEqual(sentences[0].id, 's1');
    assert.strictEqual(sentences[0].text, 'Phenomenal.');
  });

  await t.test('Case 4: Long speech pauses (>3s) split sentences even without punctuation', () => {
    const sentences = segmentWordsIntoSentences(longPauseWords);
    assert.strictEqual(sentences.length, 3);
    assert.strictEqual(sentences[0].id, 's1');
    assert.strictEqual(sentences[1].id, 's2');
    assert.strictEqual(sentences[2].id, 's3');
  });

  await t.test('Case 5: findSentenceAtTime locates exact or nearest sentence segment', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    // s1: 1.00s - 2.40s
    // s2: 3.10s - 4.70s
    // s3: 5.40s - 6.80s

    const sInS1 = findSentenceAtTime(sentences, 1.5);
    assert.strictEqual(sInS1.id, 's1');

    const sInS2 = findSentenceAtTime(sentences, 3.5);
    assert.strictEqual(sInS2.id, 's2');

    // Before all sentences (0.8s) -> closest is s1
    const sBefore = findSentenceAtTime(sentences, 0.8);
    assert.strictEqual(sBefore.id, 's1');

    // After all sentences (7.5s) -> closest is s3
    const sAfter = findSentenceAtTime(sentences, 7.5);
    assert.strictEqual(sAfter.id, 's3');
  });
});
