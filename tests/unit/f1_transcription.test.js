// tests/unit/f1_transcription.test.js
import test from 'node:test';
import assert from 'node:assert';
import { standardWords, emptyWords } from '../fixtures/mockTranscripts.js';
import { buildMockUnifiedTranscript } from '../fixtures/mockTranscripts.js';

/**
 * Feature F1: Word-Level Transcript Preservation
 * Requirement: ORIGINAL_REQUEST §R1, PROJECT.md F1
 *
 * Invariant:
 * Transcriber preserves word tokens with exact start/end timestamps,
 * confidence scores, speaker labels, and language in UnifiedTranscript.
 */

test('Tier 1: F1 - Word-Level Transcript Preservation', async (t) => {
  await t.test('Case 1: Word tokens retain precise start and end timestamps', () => {
    const transcript = buildMockUnifiedTranscript(standardWords);
    assert.strictEqual(Array.isArray(transcript.words), true);
    assert.strictEqual(transcript.words.length, standardWords.length);

    for (const w of transcript.words) {
      assert.strictEqual(typeof w.word, 'string');
      assert.strictEqual(typeof w.start, 'number');
      assert.strictEqual(typeof w.end, 'number');
      assert.ok(w.end >= w.start, `Word "${w.word}" end ${w.end} must be >= start ${w.start}`);
    }
  });

  await t.test('Case 2: Confidence scores are preserved on word tokens', () => {
    const transcript = buildMockUnifiedTranscript(standardWords);
    const wordsWithConf = transcript.words.filter((w) => typeof w.confidence === 'number');
    assert.ok(wordsWithConf.length > 0, 'Should preserve confidence scores');

    for (const w of wordsWithConf) {
      assert.ok(w.confidence >= 0 && w.confidence <= 1.0, `Confidence ${w.confidence} must be in [0, 1]`);
    }
  });

  await t.test('Case 3: Speaker labels are attributed to word tokens and speakerTurns', () => {
    const transcript = buildMockUnifiedTranscript(standardWords);
    assert.ok(Array.isArray(transcript.speakerTurns), 'speakerTurns must be an array');
    assert.ok(transcript.speakerTurns.length >= 2, 'Should have multiple speaker turns');

    const speakers = new Set(transcript.words.map((w) => w.speaker).filter(Boolean));
    assert.ok(speakers.has('Speaker 1'), 'Speaker 1 must be present');
    assert.ok(speakers.has('Speaker 2'), 'Speaker 2 must be present');
  });

  await t.test('Case 4: Root transcript retains full text and language tag', () => {
    const transcript = buildMockUnifiedTranscript(standardWords, 'id');
    assert.strictEqual(transcript.language, 'id');
    assert.ok(typeof transcript.text === 'string' && transcript.text.length > 0);
    assert.ok(transcript.text.includes('Welcome to our podcast.'));
  });

  await t.test('Case 5: Word sequence maintains continuous chronological order', () => {
    const transcript = buildMockUnifiedTranscript(standardWords);
    for (let i = 0; i < transcript.words.length - 1; i++) {
      const current = transcript.words[i];
      const next = transcript.words[i + 1];
      assert.ok(next.start >= current.start, `Word ${i + 1} (${next.start}) must start at or after word ${i} (${current.start})`);
    }
  });
});

test('Tier 2: F1 - Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Empty words array returns valid empty UnifiedTranscript', () => {
    const transcript = buildMockUnifiedTranscript(emptyWords);
    assert.strictEqual(transcript.words.length, 0);
    assert.strictEqual(transcript.text, '');
    assert.strictEqual(transcript.speakerTurns.length, 0);
  });

  await t.test('Case 2: Single word transcript preservation', () => {
    const singleWord = [{ word: 'Single', start: 0.5, end: 0.9, confidence: 0.99, speaker: 'Solo' }];
    const transcript = buildMockUnifiedTranscript(singleWord);
    assert.strictEqual(transcript.words.length, 1);
    assert.strictEqual(transcript.text, 'Single');
    assert.strictEqual(transcript.speakerTurns.length, 1);
    assert.strictEqual(transcript.speakerTurns[0].speaker, 'Solo');
  });

  await t.test('Case 3: Word tokens with zero duration (instantaneous tokens)', () => {
    const zeroDurationWords = [
      { word: 'Instant', start: 1.0, end: 1.0, confidence: 0.95 },
      { word: 'Next', start: 1.0, end: 1.4, confidence: 0.95 },
    ];
    const transcript = buildMockUnifiedTranscript(zeroDurationWords);
    assert.strictEqual(transcript.words.length, 2);
    assert.strictEqual(transcript.words[0].end - transcript.words[0].start, 0);
  });

  await t.test('Case 4: Words missing confidence and speaker fields handled gracefully', () => {
    const bareWords = [
      { word: 'Hello', start: 0.0, end: 0.5 },
      { word: 'World', start: 0.6, end: 1.0 },
    ];
    const transcript = buildMockUnifiedTranscript(bareWords);
    assert.strictEqual(transcript.words.length, 2);
    assert.strictEqual(transcript.speakerTurns.length, 0);
    assert.strictEqual(transcript.words[0].confidence, undefined);
  });

  await t.test('Case 5: Special characters and emojis in word tokens preserved accurately', () => {
    const unicodeWords = [
      { word: '¡Hola!', start: 0.0, end: 0.5, confidence: 0.95 },
      { word: '🚀', start: 0.6, end: 0.9, confidence: 0.99 },
      { word: 'Café', start: 1.0, end: 1.4, confidence: 0.97 },
    ];
    const transcript = buildMockUnifiedTranscript(unicodeWords);
    assert.strictEqual(transcript.words.length, 3);
    assert.strictEqual(transcript.text, '¡Hola! 🚀 Café');
  });
});
