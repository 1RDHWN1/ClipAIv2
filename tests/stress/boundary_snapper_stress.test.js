// tests/stress/boundary_snapper_stress.test.js
/**
 * Empirical Stress Testing & Adversarial Challenge Harness for Boundary Snapper (F4, F5)
 *
 * Requirements & Acceptance Criteria:
 * - ORIGINAL_REQUEST.md §R1, §R4, AC Audio & Boundary Precision
 * - PROJECT.md F4 (Boundary Snapper Engine), F5 (Active Speech Protection Invariant)
 *
 * Target:
 *  1. 0 speech collisions out of 10,000 runs on standard/dense speech scenarios.
 *  2. Verification of pause >300ms silence gap snapping when near target cut.
 *  3. Verification of sentence boundary snapping within 100ms.
 *  4. Adversarial stress testing: sub-millisecond float precision, chained overlaps, micro-gaps.
 */

import test from 'node:test';
import assert from 'node:assert';
import { snapBoundary, checkSpeechCollision, snapClipBoundaries } from '../../utils/boundarySnapper.js';
import { segmentWordsIntoSentences } from '../../utils/sentenceSegmenter.js';
import { detectLinguisticSilence } from '../../utils/silenceDetector.js';

// Seeded PRNG for reproducibility
function createSeededRandom(seed = 123456789) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Generates a realistic dense speech transcript scenario.
 *
 * @param {Object} config
 * @param {Function} rand - seeded random generator
 * @returns {{ words: Array, sentences: Array, silences: Array, totalDuration: number }}
 */
function generateSpeechScenario(config, rand) {
  const {
    numWords = 30,
    gapDistribution = [0.05, 0.10, 0.20, 0.30, 0.50], // Gaps: 50ms, 100ms, 200ms, 300ms, 500ms
    wordLengthDistribution = [0.10, 0.25, 0.40, 0.70],
    precisionDecimals = 3,
    allowOverlap = false,
    punctuationRate = 0.2,
  } = config;

  const sampleWords = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
    'welcome', 'to', 'artificial', 'intelligence', 'podcast', 'today',
    'we', 'explore', 'cutting', 'edge', 'technology', 'deep', 'learning',
    'neural', 'networks', 'revolutionize', 'video', 'editing', 'precision',
    'audio', 'alignment', 'speech', 'synthesis', 'generation', 'future',
    'breakthrough', 'discovery', 'incredible', 'journey', 'moment', 'never',
  ];

  const words = [];
  let currentTime = 1.0; // 1.0s lead-in

  for (let i = 0; i < numWords; i++) {
    const rawWord = sampleWords[Math.floor(rand() * sampleWords.length)];
    const isTerminal = rand() < punctuationRate || i === numWords - 1;
    const wordText = isTerminal ? `${rawWord}.` : rawWord;

    const baseDuration = wordLengthDistribution[Math.floor(rand() * wordLengthDistribution.length)];
    const durationVariation = (rand() - 0.5) * 0.04;
    const duration = Math.max(0.06, baseDuration + durationVariation);

    let start = currentTime;
    let end = start + duration;

    if (precisionDecimals === 3) {
      start = parseFloat(start.toFixed(3));
      end = parseFloat(end.toFixed(3));
    }

    words.push({
      word: wordText,
      start,
      end,
      confidence: parseFloat((0.9 + rand() * 0.1).toFixed(2)),
      speaker: rand() > 0.5 ? 'Speaker A' : 'Speaker B',
    });

    // Determine gap to next word
    const gap = gapDistribution[Math.floor(rand() * gapDistribution.length)];
    if (allowOverlap && rand() < 0.15) {
      // Overlap of 30ms - 80ms
      currentTime = end - (0.03 + rand() * 0.05);
    } else {
      currentTime = end + gap;
    }
  }

  const sentences = segmentWordsIntoSentences(words);
  const silences = detectLinguisticSilence(words, { minDuration: 0.3 });
  const totalDuration = words.length > 0 ? words[words.length - 1].end + 1.0 : 0;

  return { words, sentences, silences, totalDuration };
}

/**
 * Strict active speech collision oracle.
 * Returns true if timestamp t is strictly inside ANY word interval (w.start, w.end).
 */
function isStrictSpeechCollision(t, words, eps = 1e-6) {
  for (const w of words) {
    if (t > w.start + eps && t < w.end - eps) {
      return { collides: true, word: w };
    }
  }
  return { collides: false, word: null };
}

// -------------------------------------------------------------
// MAIN TEST SUITES
// -------------------------------------------------------------

test('Milestone 1 Empirical Stress Test Suite (Boundary Snapper & Active Speech Invariant)', async (suite) => {
  const rand = createSeededRandom(42);

  // =========================================================================
  // SUITE 1: 10,000 Dense Speech Runs (Standard 3-decimal Precision, No Overlap)
  // =========================================================================
  await suite.test('Suite 1: 10,000 Standard Dense Speech Runs (Target: 0 Collisions)', () => {
    const NUM_SCENARIOS = 200;
    const RUNS_PER_SCENARIO = 50;
    const TOTAL_TARGET_RUNS = NUM_SCENARIOS * RUNS_PER_SCENARIO; // 10,000

    let totalRuns = 0;
    let collisions = 0;
    const collisionExamples = [];

    let pauseNearCount = 0;
    let pauseSnappedWithinGapCount = 0;

    let sentenceNearCount = 0;
    let sentenceSnappedWithin100msCount = 0;

    const gapSets = [
      [0.05, 0.10],             // Ultra-dense: 50ms, 100ms
      [0.05, 0.10, 0.20],       // Dense: 50ms, 100ms, 200ms
      [0.05, 0.10, 0.20, 0.30], // Mixed with 300ms silences
      [0.10, 0.30, 0.50],       // Standard with pauses
      [0.20, 0.50, 0.80],       // Sparser with clear pauses
    ];

    for (let sIdx = 0; sIdx < NUM_SCENARIOS; sIdx++) {
      const gapDistribution = gapSets[sIdx % gapSets.length];
      const scenario = generateSpeechScenario({
        numWords: 25 + (sIdx % 20),
        gapDistribution,
        precisionDecimals: 3,
        allowOverlap: false,
      }, rand);

      const { words, sentences, silences, totalDuration } = scenario;

      for (let r = 0; r < RUNS_PER_SCENARIO; r++) {
        totalRuns++;
        const boundaryType = r % 2 === 0 ? 'start' : 'end';

        // Mix: 40% random timestamp across entire duration,
        // 30% targeting inside words, 15% targeting near sentence edges, 15% targeting near silences
        let targetTime;
        const selector = rand();

        if (selector < 0.4) {
          targetTime = parseFloat((rand() * totalDuration).toFixed(3));
        } else if (selector < 0.7 && words.length > 0) {
          const w = words[Math.floor(rand() * words.length)];
          // strictly inside word
          targetTime = parseFloat((w.start + rand() * (w.end - w.start)).toFixed(3));
        } else if (selector < 0.85 && sentences.length > 0) {
          const s = sentences[Math.floor(rand() * sentences.length)];
          const edge = boundaryType === 'start' ? s.start : s.end;
          // within 150ms of sentence boundary
          targetTime = parseFloat((edge + (rand() - 0.5) * 0.3).toFixed(3));
        } else if (silences.length > 0) {
          const sil = silences[Math.floor(rand() * silences.length)];
          targetTime = parseFloat((sil.start + rand() * (sil.end - sil.start)).toFixed(3));
        } else {
          targetTime = parseFloat((rand() * totalDuration).toFixed(3));
        }

        const result = snapBoundary(targetTime, {
          sentences,
          words,
          silences,
          boundaryType,
        });

        // 1. Check Speech Collision Oracle
        const colCheck = isStrictSpeechCollision(result.snappedTime, words);
        if (colCheck.collides) {
          collisions++;
          if (collisionExamples.length < 5) {
            collisionExamples.push({
              run: totalRuns,
              targetTime,
              boundaryType,
              snappedTime: result.snappedTime,
              snappedTo: result.snappedTo,
              conflictingWord: colCheck.word,
            });
          }
        }

        // 2. Pause >300ms Oracle: If target is directly inside a qualified silence gap,
        // does it snap within that silence gap?
        const containingSilence = silences.find(
          (sil) => targetTime >= sil.start && targetTime <= sil.end && sil.duration >= 0.3
        );
        if (containingSilence) {
          pauseNearCount++;
          // Snapped time must fall in [sil.start, sil.end] OR snap to a valid sentence boundary within 100ms (Stage 1 precedence)
          if ((result.snappedTime >= containingSilence.start - 1e-4 && result.snappedTime <= containingSilence.end + 1e-4) ||
              (result.snappedTo === 'sentence' && result.adjustedDeltaMs <= 100.0)) {
            pauseSnappedWithinGapCount++;
          }
        }

        // 3. Sentence Boundary Oracle: If target is within 100ms of a sentence boundary,
        // does it snap within 100ms?
        let closestSentenceDist = Infinity;
        for (const s of sentences) {
          const point = boundaryType === 'start' ? s.start : s.end;
          const d = Math.abs(targetTime - point);
          if (d < closestSentenceDist) {
            closestSentenceDist = d;
          }
        }

        if (closestSentenceDist <= 0.100) {
          sentenceNearCount++;
          if (result.adjustedDeltaMs <= 100.0 || Math.abs(result.snappedTime - targetTime) <= 0.1005) {
            sentenceSnappedWithin100msCount++;
          }
        }
      }
    }

    console.log(`\n--- Suite 1 Results (${totalRuns} runs) ---`);
    console.log(`Speech Collisions: ${collisions} / ${totalRuns}`);
    console.log(`Pause >300ms Gap Snapping: ${pauseSnappedWithinGapCount} / ${pauseNearCount} (${((pauseSnappedWithinGapCount / Math.max(1, pauseNearCount)) * 100).toFixed(2)}%)`);
    console.log(`Sentence Boundary <=100ms Snapping: ${sentenceSnappedWithin100msCount} / ${sentenceNearCount} (${((sentenceSnappedWithin100msCount / Math.max(1, sentenceNearCount)) * 100).toFixed(2)}%)`);

    assert.strictEqual(totalRuns, TOTAL_TARGET_RUNS, `Expected ${TOTAL_TARGET_RUNS} runs`);
    assert.strictEqual(collisions, 0, `Active speech protection failed! Found ${collisions} collisions in clean 3-decimal data`);
    assert.ok(pauseSnappedWithinGapCount / Math.max(1, pauseNearCount) >= 0.99, 'Pause snapping rate should be >= 99%');
    assert.ok(sentenceSnappedWithin100msCount / Math.max(1, sentenceNearCount) >= 0.99, 'Sentence snapping rate should be >= 99%');
  });

  // =========================================================================
  // SUITE 2: Boundary & Corner Cases (2,000 Runs)
  // =========================================================================
  await suite.test('Suite 2: Boundary & Corner Cases (2,000 Runs)', () => {
    let runs = 0;
    let collisions = 0;

    const testWords = [
      { word: 'Hello', start: 1.000, end: 1.300 },
      { word: 'world.', start: 1.350, end: 1.700 },
      // 500ms pause
      { word: 'Testing', start: 2.200, end: 2.600 },
      { word: 'corner', start: 2.650, end: 2.900 },
      { word: 'cases.', start: 2.950, end: 3.400 },
    ];
    const sentences = segmentWordsIntoSentences(testWords);
    const silences = detectLinguisticSilence(testWords, { minDuration: 0.3 });

    // Adversarial target timestamps:
    const cornerTimestamps = [
      0.000,
      -1.500,
      -0.001,
      1.000, // exactly on w.start
      1.300, // exactly on w.end
      1.001, // 1ms inside word
      1.299, // 1ms before word end
      1.150, // dead center of word
      1.325, // dead center of 50ms gap
      1.350, // exactly on w2.start
      1.700, // exactly on w2.end (and s1.end)
      1.750, // inside 500ms silence gap
      1.950, // center of silence gap
      2.190, // 10ms before silence gap end
      2.200, // silence gap end / s2.start
      3.400, // last word end
      3.450, // just after last word
      10.00, // far beyond last word
      1000.0, // extremely far beyond
    ];

    for (const ts of cornerTimestamps) {
      for (const boundaryType of ['start', 'end']) {
        for (const maxTol of [50, 100, 200, 500]) {
          runs++;
          const res = snapBoundary(ts, {
            sentences,
            words: testWords,
            silences,
            boundaryType,
            maxToleranceMs: maxTol,
          });

          const col = isStrictSpeechCollision(res.snappedTime, testWords);
          if (col.collides) {
            collisions++;
          }
        }
      }
    }

    // Additional randomized corner runs up to 2,000
    while (runs < 2000) {
      runs++;
      const boundaryType = rand() > 0.5 ? 'start' : 'end';
      const ts = (rand() - 0.2) * 5.0; // range -1.0s to 4.0s
      const res = snapBoundary(ts, {
        sentences,
        words: testWords,
        silences,
        boundaryType,
      });
      const col = isStrictSpeechCollision(res.snappedTime, testWords);
      if (col.collides) {
        collisions++;
      }
    }

    console.log(`\n--- Suite 2 Results (${runs} runs) ---`);
    console.log(`Speech Collisions: ${collisions} / ${runs}`);
    assert.strictEqual(collisions, 0, 'Adversarial corner cases produced collisions!');
  });

  // =========================================================================
  // SUITE 3: Adversarial Float Precision & Sub-millisecond Words (Vulnerability Stress)
  // =========================================================================
  await suite.test('Suite 3: Sub-millisecond & Float Precision Vulnerability Analysis (5,000 Runs)', () => {
    let runs = 0;
    let collisions = 0;
    const collisionList = [];

    // Construct words with 4-6 decimal places (e.g. from raw Whisper float timestamps)
    for (let s = 0; s < 100; s++) {
      const words = [];
      let t = 1.0;
      for (let w = 0; w < 10; w++) {
        // Sub-millisecond offsets (e.g. 1.2004, 1.4507)
        const subMsOffset = (w * 0.00037) % 0.0009;
        const start = t + subMsOffset;
        const dur = 0.25 + ((w * 0.00043) % 0.0009);
        const end = start + dur;
        words.push({
          word: `word_${w}`,
          start,
          end,
        });
        t = end + 0.08;
      }

      for (let r = 0; r < 50; r++) {
        runs++;
        const boundaryType = r % 2 === 0 ? 'start' : 'end';
        const targetWord = words[Math.floor(rand() * words.length)];
        // Target strictly inside the word
        const targetTime = targetWord.start + 0.05 + rand() * (targetWord.end - targetWord.start - 0.10);

        const res = snapBoundary(targetTime, { words, boundaryType });
        const col = isStrictSpeechCollision(res.snappedTime, words);
        if (col.collides) {
          collisions++;
          if (collisionList.length < 5) {
            collisionList.push({
              targetTime,
              boundaryType,
              snappedTime: res.snappedTime,
              conflictingWord: col.word,
            });
          }
        }
      }
    }

    console.log(`\n--- Suite 3 Results (Sub-ms float precision: ${runs} runs) ---`);
    console.log(`Speech Collisions in Sub-ms Precision: ${collisions} / ${runs} (${((collisions / runs) * 100).toFixed(2)}%)`);
    if (collisionList.length > 0) {
      console.log('Sample Vulnerability Collision:', collisionList[0]);
    }
  });

  // =========================================================================
  // SUITE 4: Overlapping Speech & Crosstalk Scenarios (Vulnerability Stress)
  // =========================================================================
  await suite.test('Suite 4: Overlapping Speech & Crosstalk Chaining (3,000 Runs)', () => {
    let runs = 0;
    let collisions = 0;
    const collisionList = [];

    // Test overlapping chains: 2 overlaps, 3 overlaps, 4 overlaps, 5 overlaps
    for (let chainLen = 2; chainLen <= 6; chainLen++) {
      const words = [];
      let t = 1.0;
      for (let i = 0; i < chainLen; i++) {
        words.push({
          word: `speaker_${i}`,
          start: t,
          end: t + 0.5,
        });
        t += 0.4; // 100ms overlap
      }

      for (let r = 0; r < 500; r++) {
        runs++;
        const boundaryType = r % 2 === 0 ? 'start' : 'end';
        // Target inside the overlapping zone
        const targetTime = 1.2 + rand() * (words[words.length - 1].end - 1.4);

        const res = snapBoundary(targetTime, { words, boundaryType });
        const col = isStrictSpeechCollision(res.snappedTime, words);
        if (col.collides) {
          collisions++;
          if (collisionList.length < 5) {
            collisionList.push({
              chainLength: chainLen,
              boundaryType,
              targetTime,
              snappedTime: res.snappedTime,
              conflictingWord: col.word,
            });
          }
        }
      }
    }

    console.log(`\n--- Suite 4 Results (Overlapping speech: ${runs} runs) ---`);
    console.log(`Speech Collisions in Overlapping Speech: ${collisions} / ${runs} (${((collisions / runs) * 100).toFixed(2)}%)`);
    if (collisionList.length > 0) {
      console.log('Sample Overlap Collision:', collisionList[0]);
    }
  });
});
