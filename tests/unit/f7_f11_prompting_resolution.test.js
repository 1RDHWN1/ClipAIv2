// tests/unit/f7_f11_prompting_resolution.test.js
import test from 'node:test';
import assert from 'node:assert';
import { segmentWordsIntoSentences, buildSentenceMap } from '../../utils/sentenceSegmenter.js';
import { snapBoundary } from '../../utils/boundarySnapper.js';
import { detectLinguisticSilence } from '../../utils/silenceDetector.js';
import { standardWords } from '../fixtures/mockTranscripts.js';
import {
  mockQuestionClip,
  mockBoldStatementClip,
} from '../fixtures/mockNarratives.js';

/**
 * Features F7 & F11: Discrete Sentence ID Prompting & Resolution
 * Requirements: ORIGINAL_REQUEST §R2, AC Analysis & Hook Quality, PROJECT.md F7, F11
 *
 * Invariants:
 *  F7: Prompts formatted using discrete sentence IDs (s1..sN) instead of floating timestamps.
 *  F11: Resolves startSentenceId and endSentenceId to pre-snapped video timestamps via SentenceMap.
 */

const sentences = segmentWordsIntoSentences(standardWords);
const sentenceMap = buildSentenceMap(sentences);
const silences = detectLinguisticSilence(standardWords);

/**
 * Reference implementation of F7: Format AI prompt using discrete sentence IDs
 * @param {Array<Object>} sentencesList
 * @param {number} duration
 * @param {number} clipCount
 * @returns {string}
 */
export function buildDiscreteSentencePrompt(sentencesList, duration, clipCount = 3) {
  if (!Array.isArray(sentencesList) || sentencesList.length === 0) {
    throw new Error('sentencesList must be a non-empty array');
  }

  const formattedLines = sentencesList.map((s) => {
    const spk = s.speaker ? ` [${s.speaker}]` : '';
    return `[${s.id}]${spk}: ${s.text}`;
  });

  return [
    `You are an expert viral video editor.`,
    `Video duration: ${duration} seconds. Total sentences: ${sentencesList.length}.`,
    `=== SENTENCE SEGMENTS ===`,
    ...formattedLines,
    `=========================`,
    `Select exactly ${clipCount} clips. For every clip, return:`,
    `- startSentenceId: (e.g. "s1")`,
    `- endSentenceId: (e.g. "s3")`,
    `- hookClassification: one of ["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]`,
    `- hookText: the text of the opening hook`,
    `- narrativeRationale: { setup, climax, conclusion, isCompleteArc }`,
    `- viralityScore: 0-100`,
    `- viralityRationale: explanation`,
  ].join('\n');
}

/**
 * Reference implementation of F11: Deterministic Sentence ID Resolution
 * Maps startSentenceId and endSentenceId to pre-snapped timestamps.
 * @param {Object} clip
 * @param {Map<string, Object>} map
 * @param {Object} context
 * @returns {Object}
 */
export function resolveSentenceIds(clip, map, context = {}) {
  if (!clip || typeof clip !== 'object') {
    throw new Error('Invalid clip object');
  }
  const { startSentenceId, endSentenceId } = clip;
  if (!startSentenceId || !map.has(startSentenceId)) {
    throw new Error(`Invalid startSentenceId "${startSentenceId}" not found in sentence map`);
  }
  if (!endSentenceId || !map.has(endSentenceId)) {
    throw new Error(`Invalid endSentenceId "${endSentenceId}" not found in sentence map`);
  }

  const startSentence = map.get(startSentenceId);
  const endSentence = map.get(endSentenceId);

  if (startSentence.index > endSentence.index) {
    throw new Error(`startSentenceId "${startSentenceId}" (index ${startSentence.index}) cannot be after endSentenceId "${endSentenceId}" (index ${endSentence.index})`);
  }

  // Pre-snap boundaries using boundary snapper
  const startSnap = snapBoundary(startSentence.start, {
    ...context,
    boundaryType: 'start',
  });
  const endSnap = snapBoundary(endSentence.end, {
    ...context,
    boundaryType: 'end',
  });

  return {
    ...clip,
    start: startSnap.snappedTime,
    end: endSnap.snappedTime,
    resolvedSentences: {
      count: endSentence.index - startSentence.index + 1,
      startText: startSentence.text,
      endText: endSentence.text,
    },
    snappingDetails: {
      start: startSnap,
      end: endSnap,
    },
  };
}

test('Tier 1: F7 - Discrete Sentence ID Prompting', async (t) => {
  await t.test('Case 1: Prompt formats segments with discrete IDs [s1], [s2], [s3]', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 1);
    assert.ok(prompt.includes('[s1]'));
    assert.ok(prompt.includes('Welcome to our podcast.'));
    assert.ok(prompt.includes('[s2]'));
    assert.ok(prompt.includes('Today we have an incredible guest.'));
    assert.ok(prompt.includes('[s3]'));
    assert.ok(prompt.includes('Tell us your secret story.'));
  });

  await t.test('Case 2: Prompt embeds video duration and sentence count context', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 1);
    assert.ok(prompt.includes('Video duration: 10 seconds'));
    assert.ok(prompt.includes('Total sentences: 3'));
  });

  await t.test('Case 3: Prompt specifies required output fields including startSentenceId and endSentenceId', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 1);
    assert.ok(prompt.includes('startSentenceId'));
    assert.ok(prompt.includes('endSentenceId'));
    assert.ok(prompt.includes('hookClassification'));
    assert.ok(prompt.includes('narrativeRationale'));
  });

  await t.test('Case 4: Prompt includes speaker attribution when available', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 1);
    assert.ok(prompt.includes('[Speaker 1]'));
    assert.ok(prompt.includes('[Speaker 2]'));
  });

  await t.test('Case 5: Prompt includes standardized hook taxonomy list', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 1);
    assert.ok(prompt.includes('question'));
    assert.ok(prompt.includes('bold_statement'));
    assert.ok(prompt.includes('negative_hook'));
    assert.ok(prompt.includes('story_anecdote'));
    assert.ok(prompt.includes('shocking_fact'));
    assert.ok(prompt.includes('action_instruction'));
  });
});

test('Tier 2: F7 - Prompting Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Empty sentence list throws descriptive error', () => {
    assert.throws(() => buildDiscreteSentencePrompt([], 10.0), /non-empty array/);
  });

  await t.test('Case 2: Single sentence transcript formats prompt correctly with only s1', () => {
    const single = [{ id: 's1', index: 0, text: 'Only one line.', start: 0, end: 1.5 }];
    const prompt = buildDiscreteSentencePrompt(single, 1.5, 1);
    assert.ok(prompt.includes('[s1]: Only one line.'));
    assert.ok(!prompt.includes('[s2]'));
  });

  await t.test('Case 3: Sentences with quotation marks and punctuation in text format cleanly', () => {
    const quotes = [{ id: 's1', index: 0, text: 'He said, "Never give up!"', start: 0, end: 2 }];
    const prompt = buildDiscreteSentencePrompt(quotes, 2, 1);
    assert.ok(prompt.includes('He said, "Never give up!"'));
  });

  await t.test('Case 4: Clip count parameter reflected in instructions', () => {
    const prompt = buildDiscreteSentencePrompt(sentences, 10.0, 5);
    assert.ok(prompt.includes('Select exactly 5 clips'));
  });

  await t.test('Case 5: Non-array sentence input throws error', () => {
    assert.throws(() => buildDiscreteSentencePrompt('not an array', 10.0), /non-empty array/);
  });
});

test('Tier 1: F11 - Deterministic Sentence ID Resolution', async (t) => {
  await t.test('Case 1: Resolves s1 and s2 to pre-snapped video timestamps', () => {
    const resolved = resolveSentenceIds(mockQuestionClip, sentenceMap, {
      sentences,
      words: standardWords,
      silences,
    });
    assert.ok(typeof resolved.start === 'number');
    assert.ok(typeof resolved.end === 'number');
    // s1 starts at 1.00s, s2 ends at 4.70s
    assert.ok(Math.abs(resolved.start - 1.00) <= 0.1);
    assert.ok(Math.abs(resolved.end - 4.70) <= 0.1);
  });

  await t.test('Case 2: SentenceMap enables O(1) lookup of boundary metadata', () => {
    assert.ok(sentenceMap.has('s1'));
    assert.strictEqual(sentenceMap.get('s1').start, 1.00);
    assert.strictEqual(sentenceMap.get('s1').end, 2.40);
  });

  await t.test('Case 3: Preserves all narrative and virality fields in resolved clip', () => {
    const resolved = resolveSentenceIds(mockQuestionClip, sentenceMap, {
      sentences,
      words: standardWords,
      silences,
    });
    assert.strictEqual(resolved.title, mockQuestionClip.title);
    assert.strictEqual(resolved.hookClassification, 'question');
    assert.strictEqual(resolved.viralityScore, 92);
    assert.strictEqual(resolved.narrativeRationale.isCompleteArc, true);
  });

  await t.test('Case 4: Populates resolvedSentences count and summary', () => {
    const resolved = resolveSentenceIds(mockQuestionClip, sentenceMap, {
      sentences,
      words: standardWords,
      silences,
    });
    assert.strictEqual(resolved.resolvedSentences.count, 2); // s1 to s2 = 2 sentences
    assert.strictEqual(resolved.resolvedSentences.startText, 'Welcome to our podcast.');
  });

  await t.test('Case 5: Attaches snapping details confirming sentence/silence snapping', () => {
    const resolved = resolveSentenceIds(mockQuestionClip, sentenceMap, {
      sentences,
      words: standardWords,
      silences,
    });
    assert.ok(resolved.snappingDetails.start);
    assert.ok(resolved.snappingDetails.end);
    assert.strictEqual(resolved.snappingDetails.start.snappedTo, 'sentence');
    assert.strictEqual(resolved.snappingDetails.end.snappedTo, 'sentence');
  });
});

test('Tier 2: F11 - Resolution Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Unknown startSentenceId (e.g. s999) throws error', () => {
    const badClip = { ...mockQuestionClip, startSentenceId: 's999' };
    assert.throws(() => resolveSentenceIds(badClip, sentenceMap), /not found in sentence map/);
  });

  await t.test('Case 2: Unknown endSentenceId (e.g. s999) throws error', () => {
    const badClip = { ...mockQuestionClip, endSentenceId: 's999' };
    assert.throws(() => resolveSentenceIds(badClip, sentenceMap), /not found in sentence map/);
  });

  await t.test('Case 3: Inverted sentence IDs (start after end, e.g. s3 to s1) throws error', () => {
    const invertedClip = { ...mockQuestionClip, startSentenceId: 's3', endSentenceId: 's1' };
    assert.throws(() => resolveSentenceIds(invertedClip, sentenceMap), /cannot be after/);
  });

  await t.test('Case 4: Single sentence clip (s2 to s2) resolves start and end of that sentence', () => {
    const singleClip = { ...mockQuestionClip, startSentenceId: 's2', endSentenceId: 's2' };
    const resolved = resolveSentenceIds(singleClip, sentenceMap, { sentences, words: standardWords, silences });
    assert.strictEqual(resolved.resolvedSentences.count, 1);
    // s2: 3.10s - 4.70s
    assert.ok(Math.abs(resolved.start - 3.10) <= 0.1);
    assert.ok(Math.abs(resolved.end - 4.70) <= 0.1);
  });

  await t.test('Case 5: Invalid / non-object clip input throws descriptive error', () => {
    assert.throws(() => resolveSentenceIds(null, sentenceMap), /Invalid clip object/);
    assert.throws(() => resolveSentenceIds('string', sentenceMap), /Invalid clip object/);
  });
});
