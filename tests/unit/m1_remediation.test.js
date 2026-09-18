// tests/unit/m1_remediation.test.js
import test from 'node:test';
import assert from 'node:assert';
import {
  snapBoundary,
  snapClipBoundaries,
  checkSpeechCollision,
  buildAudioCrossfadeFilter,
  DEFAULT_FADE_DURATION,
} from '../../utils/boundarySnapper.js';
import {
  segmentWordsIntoSentences,
  findSentenceAtTime,
} from '../../utils/sentenceSegmenter.js';
import {
  detectLinguisticSilence,
} from '../../utils/silenceDetector.js';

test('Milestone 1 Remediation: Boundary Snapping & Seam Crossfade Invariants', async (t) => {
  await t.test('F6: buildAudioCrossfadeFilter exports and generates valid afade filter', () => {
    assert.strictEqual(DEFAULT_FADE_DURATION, 0.030);

    const f10 = buildAudioCrossfadeFilter(10.0);
    assert.strictEqual(f10, 'afade=t=in:st=0:d=0.030,afade=t=out:st=9.970:d=0.030');

    // Short clip (< 60ms) clamped to duration / 2
    const fShort = buildAudioCrossfadeFilter(0.040);
    assert.strictEqual(fShort, 'afade=t=in:st=0:d=0.020,afade=t=out:st=0.020:d=0.020');

    // Invalid duration throws
    assert.throws(() => buildAudioCrossfadeFilter(0), /Invalid duration/);
    assert.throws(() => buildAudioCrossfadeFilter(-1.0), /Invalid duration/);
    assert.throws(() => buildAudioCrossfadeFilter(NaN), /Invalid duration/);
  });

  await t.test('F4/F5: snapClipBoundaries guards against same-silence interval inversion', () => {
    const silences = [{ start: 2.0, end: 3.0, duration: 1.0, source: 'linguistic' }];
    const clip = { start: 2.3, end: 2.8, title: 'Inside Silence' };
    const snapped = snapClipBoundaries(clip, { silences });

    assert.ok(snapped.end > snapped.start, 'Snapped end must be strictly greater than start');
    assert.ok(snapped.start >= 2.0 && snapped.end <= 3.0, 'Snapped clip must remain inside silence interval');
    assert.strictEqual(snapped.start, 2.3);
    assert.strictEqual(snapped.end, 2.8);
  });

  await t.test('F4/F5: snapClipBoundaries throws on inverted input clip.end <= clip.start', () => {
    assert.throws(() => {
      snapClipBoundaries({ start: 5.0, end: 3.0 });
    }, /must be greater than clip\.start/);

    assert.throws(() => {
      snapClipBoundaries({ start: 3.0, end: 3.0 });
    }, /must be greater than clip\.start/);
  });

  await t.test('F4: Exact sentence boundary snapping without 30ms cushioning offset', () => {
    const sentences = [
      { id: 's1', start: 1.000, end: 2.400, text: 'Hello world.' },
    ];
    const silences = [
      { start: 0.0, end: 1.000, duration: 1.000 },
      { start: 2.400, end: 3.200, duration: 0.800 },
    ];

    // Near start (1.05s) should snap directly to 1.000s, not cushioned to 0.970s
    const startRes = snapBoundary(1.050, { sentences, silences, boundaryType: 'start' });
    assert.strictEqual(startRes.snappedTo, 'sentence');
    assert.strictEqual(startRes.snappedTime, 1.000);

    // Near end (2.35s) should snap directly to 2.400s, not cushioned to 2.430s
    const endRes = snapBoundary(2.350, { sentences, silences, boundaryType: 'end' });
    assert.strictEqual(endRes.snappedTo, 'sentence');
    assert.strictEqual(endRes.snappedTime, 2.400);
  });

  await t.test('F5: Outward directed quantization with sub-millisecond float timestamps', () => {
    // Word starting at 1.66154: start cut should round down to 1.661, not round up to 1.662 (inside word)
    const words = [
      { word: 'test', start: 1.66154, end: 1.9124 },
    ];
    const resStart = snapBoundary(1.700, { words, boundaryType: 'start' });
    const colStart = checkSpeechCollision(resStart.snappedTime, words);
    assert.strictEqual(colStart.collides, false, 'Start snapped time must not collide with word');
    assert.ok(resStart.snappedTime <= 1.66154, 'Start cut must round outward (down)');

    // Word ending at 3.8981: end cut should round up to 3.899, not round down to 3.898 (inside word)
    const wordsEnd = [
      { word: 'test2', start: 3.64736, end: 3.8981 },
    ];
    const resEnd = snapBoundary(3.700, { words: wordsEnd, boundaryType: 'end' });
    const colEnd = checkSpeechCollision(resEnd.snappedTime, wordsEnd);
    assert.strictEqual(colEnd.collides, false, 'End snapped time must not collide with word');
    assert.ok(resEnd.snappedTime >= 3.8981, 'End cut must round outward (up)');
  });

  await t.test('F5: Iterative monotonic while-loop resolves chained multi-word speech overlaps', () => {
    const chainedWords = [
      { word: 'w1', start: 1.0, end: 1.5 },
      { word: 'w2', start: 1.4, end: 2.0 },
      { word: 'w3', start: 1.9, end: 2.5 },
      { word: 'w4', start: 2.4, end: 3.0 },
    ];

    // End cut inside chained speech must progress past entire chain to 3.000s
    const resEnd = snapBoundary(1.45, { words: chainedWords, boundaryType: 'end' });
    const colEnd = checkSpeechCollision(resEnd.snappedTime, chainedWords);
    assert.strictEqual(colEnd.collides, false, 'Chained overlap end must have 0 collisions');
    assert.strictEqual(resEnd.snappedTime, 3.000);

    // Start cut inside chained speech must step back to 1.000s
    const resStart = snapBoundary(2.55, { words: chainedWords, boundaryType: 'start' });
    const colStart = checkSpeechCollision(resStart.snappedTime, chainedWords);
    assert.strictEqual(colStart.collides, false, 'Chained overlap start must have 0 collisions');
    assert.strictEqual(resStart.snappedTime, 1.000);
  });
});

test('Milestone 1 Remediation: Sentence Segmentation & Silence Detection Robustness', async (t) => {
  await t.test('F2: "No." abbreviation collision resolved contextually with digit lookahead', () => {
    // "No. I refuse." splits into 2 sentences
    const wordsRejection = [
      { word: 'No.', start: 1.0, end: 1.3 },
      { word: 'I', start: 1.4, end: 1.6 },
      { word: 'refuse.', start: 1.65, end: 2.0 },
    ];
    const sRejection = segmentWordsIntoSentences(wordsRejection);
    assert.strictEqual(sRejection.length, 2);
    assert.strictEqual(sRejection[0].text, 'No.');
    assert.strictEqual(sRejection[1].text, 'I refuse.');

    // "No. 5 is my favorite." preserves "No." abbreviation
    const wordsNumber = [
      { word: 'No.', start: 1.0, end: 1.3 },
      { word: '5', start: 1.35, end: 1.5 },
      { word: 'is', start: 1.55, end: 1.7 },
      { word: 'my', start: 1.75, end: 1.9 },
      { word: 'favorite.', start: 1.95, end: 2.4 },
    ];
    const sNumber = segmentWordsIntoSentences(wordsNumber);
    assert.strictEqual(sNumber.length, 1);
    assert.strictEqual(sNumber[0].text, 'No. 5 is my favorite.');
  });

  await t.test('F2: Sentence end strictly covers maximum word end under crosstalk', () => {
    const crosstalk = [
      { word: 'LongSpeech', start: 1.0, end: 3.5 },
      { word: 'interjection', start: 1.2, end: 1.8 },
      { word: 'done.', start: 2.0, end: 2.4 },
    ];
    const sentences = segmentWordsIntoSentences(crosstalk);
    assert.strictEqual(sentences.length, 1);
    assert.strictEqual(sentences[0].end, 3.5, 'sentence.end must cover LongSpeech ending at 3.5');
  });

  await t.test('F2: findSentenceAtTime accurately calculates initial minDistance to end boundary', () => {
    const sentences = [
      { id: 's1', start: 1.0, end: 5.0, text: 'Sentence one.' },
      { id: 's2', start: 10.0, end: 12.0, text: 'Sentence two.' },
    ];
    // Target 5.2s is 0.2s from s1.end and 4.8s from s2.start
    const found = findSentenceAtTime(sentences, 5.2);
    assert.ok(found);
    assert.strictEqual(found.id, 's1');
  });

  await t.test('F3: detectLinguisticSilence does not report false silence during crosstalk', () => {
    const words = [
      { word: 'Speaker1', start: 1.0, end: 4.0 },
      { word: 'Speaker2_A', start: 1.5, end: 2.0 },
      { word: 'Speaker2_B', start: 2.5, end: 3.0 },
    ];
    const silences = detectLinguisticSilence(words, { totalDuration: 5.0 });

    // There should be NO silence between 2.0 and 2.5
    const falseSilence = silences.find((s) => s.start === 2.0 && s.end === 2.5);
    assert.strictEqual(falseSilence, undefined);

    // Trailing silence should start after 4.0 (the max end), not 3.0
    const trailing = silences.find((s) => s.start === 4.0 && s.end === 5.0);
    assert.ok(trailing, 'Trailing silence should be from 4.0 to 5.0');
  });
});
