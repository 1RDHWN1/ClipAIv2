// tests/unit/challenger_m1_1.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_BASE_URL,
  VALID_HOOK_TAXONOMY,
  buildDiscreteSentencePrompt,
  resolveSentenceIds,
  validateNarrativeClipSchema,
  resolveModelConfiguration,
  buildGatewayCandidates,
} from '../../utils/analyzer.js';
import * as analyzerModule from '../../utils/analyzer.js';

/**
 * Challenger 1 Adversarial & Empirical Test Suite: AI Prompt & Virality Engine
 * Milestone: M1 (Features F1, F2, F3, F4, F5)
 * Requirements: ORIGINAL_REQUEST.md (2026-09-18T20:23:27Z R1), PROJECT.md
 *
 * Scope:
 * 1. buildDiscreteSentencePrompt with English, Indonesian, and mixed transcripts.
 * 2. 0-3s pattern interrupt guidance, curiosity gaps, 4-pillar virality scoring, and invariant tokens.
 * 3. parseClipPayload and validateClips edge-case payloads (markdown formatting, missing fields, malformed ranges).
 * 4. Architectural export conformance and boundary conditions.
 */

// Dynamically extract unexported helper functions from utils/analyzer.js for direct empirical testing
const analyzerSource = fs.readFileSync('utils/analyzer.js', 'utf-8');

const parseClipPayloadMatch = analyzerSource.match(/function parseClipPayload[\s\S]*?\n\}/);
if (!parseClipPayloadMatch) {
  throw new Error('Could not locate parseClipPayload in utils/analyzer.js');
}
const parseClipPayload = new Function(parseClipPayloadMatch[0] + '; return parseClipPayload;')();

const validateClipsMatch = analyzerSource.match(/function validateClips[\s\S]*?\n\}/);
if (!validateClipsMatch) {
  throw new Error('Could not locate validateClips in utils/analyzer.js');
}
const validateClips = new Function(validateClipsMatch[0] + '; return validateClips;')();

// Test fixtures
const sampleEnglishSentences = [
  { id: 's1', index: 0, start: 0.0, end: 2.5, text: 'Have you ever wondered why most startups fail within the first year?' },
  { id: 's2', index: 1, start: 2.8, end: 6.2, text: 'We analyzed over ten thousand founders to find the single fatal pattern.', speaker: 'Alex' },
  { id: 's3', index: 2, start: 6.5, end: 11.0, text: 'The secret is not lack of funding, but building before talking to users.', speaker: 'Alex' },
  { id: 's4', index: 3, start: 11.5, end: 15.0, text: 'Once you fix this feedback loop, retention skyrockets immediately.' },
];

const sampleIndonesianSentences = [
  { id: 's1', index: 0, start: 0.0, end: 3.0, text: 'Banyak orang mengira sukses bisnis online itu cuma soal modal besar.' },
  { id: 's2', index: 1, start: 3.2, end: 7.5, text: 'Padahal rahasia terbesarnya ada di cara membangun audiens sejak hari pertama.', speaker: 'Budi' },
  { id: 's3', index: 2, start: 7.8, end: 12.0, text: 'Jangan pernah jualan produk sebelum kamu tahu masalah utama mereka.', speaker: 'Budi' },
  { id: 's4', index: 3, start: 12.2, end: 16.0, text: 'Begitu mereka percaya, penjualan akan datang dengan sendirinya.' },
];

const sampleMixedSentences = [
  { id: 's1', index: 0, start: 0.0, end: 2.8, text: 'So basically, mindset orang tentang AI saat ini masih agak keliru.' },
  { id: 's2', index: 1, start: 3.0, end: 6.5, text: 'AI bukan mau replace developer, tapi accelerate workflow kita sepuluh kali lipat.', speaker: 'Sarah' },
  { id: 's3', index: 2, start: 6.8, end: 10.5, text: 'Kalau kamu ignore tools ini sekarang, kamu bakal ketinggalan jauh banget.', speaker: 'Sarah' },
];

const sentenceMap = new Map();
sampleEnglishSentences.forEach((s) => sentenceMap.set(s.id, s));

// =========================================================================
// TEST GROUP 1: buildDiscreteSentencePrompt Multilingual & Virality Verification
// =========================================================================
test('Challenger 1 Suite: buildDiscreteSentencePrompt Multilingual & Virality Directives', async (t) => {
  await t.test('1.1 English transcript produces comprehensive viral strategist prompt', () => {
    const prompt = buildDiscreteSentencePrompt(sampleEnglishSentences, 120, 3, { language: 'en' });

    // Persona & Model Guidance
    assert.ok(prompt.includes('You are an elite viral content strategist and master short-form video editor'));
    assert.ok(prompt.includes('inspired by Opus Clip and modern TikTok, YouTube Shorts, and Instagram Reels virality formulas'));

    // 0-3s Pattern Interrupt Directive
    assert.ok(prompt.includes('0-3s PATTERN INTERRUPT'));
    assert.ok(prompt.includes('curiosity gap'));
    assert.ok(prompt.includes('emotional hook'));

    // 4-Pillar Virality Scoring Directives
    assert.ok(prompt.includes('4-PILLAR VIRALITY SCORING FORMULA'));
    assert.ok(prompt.includes('1. Hook Strength (0-25)'));
    assert.ok(prompt.includes('2. Pacing (0-25)'));
    assert.ok(prompt.includes('3. Retention Potential (0-25)'));
    assert.ok(prompt.includes('4. Payoff Clarity (0-25)'));

    // English Language Directives
    assert.ok(prompt.includes('LANGUAGE REQUIREMENTS:'));
    assert.ok(prompt.includes('The video dialogue is in English.'));
    assert.ok(prompt.includes('MUST be written in natural, engaging English'));
    assert.ok(prompt.includes('punchy, high-CTR title (max 8 words)'));
    assert.ok(prompt.includes('avoiding bland summaries like "Compelling Clip"'));

    // Strict Taxonomy Invariant
    assert.ok(prompt.includes('STRICT TAXONOMY INVARIANT:'));
    assert.ok(prompt.includes('["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]'));

    // Segment formatting
    assert.ok(prompt.includes('[s1]: Have you ever wondered why most startups fail within the first year?'));
    assert.ok(prompt.includes('[s2] [Alex]: We analyzed over ten thousand founders to find the single fatal pattern.'));
    assert.ok(prompt.includes('Select exactly 3 viral highlight clips'));
    assert.ok(prompt.includes('Video duration: 120 seconds. Total sentences: 4.'));
  });

  await t.test('1.2 Indonesian transcript produces native Indonesian viral strategist directives', () => {
    const prompt = buildDiscreteSentencePrompt(sampleIndonesianSentences, 90, 2, { language: 'id' });

    // Global Virality Engine
    assert.ok(prompt.includes('You are an elite viral content strategist'));
    assert.ok(prompt.includes('0-3s PATTERN INTERRUPT'));
    assert.ok(prompt.includes('4-PILLAR VIRALITY SCORING FORMULA'));

    // Indonesian Specific Directives
    assert.ok(prompt.includes('PETUNJUK BAHASA:'));
    assert.ok(prompt.includes('Dialog video dalam bahasa Indonesia.'));
    assert.ok(prompt.includes('HARUS ditulis dalam bahasa Indonesia'));
    assert.ok(prompt.includes('judul high-CTR yang memikat dan memicu rasa penasaran (maks 8 kata)'));
    assert.ok(prompt.includes('hindari ringkasan hambar seperti "Clip Menarik"'));

    // Invariant Taxonomy Preservation in Indonesian prompt
    assert.ok(prompt.includes('STRICT TAXONOMY INVARIANT:'));
    assert.ok(prompt.includes('JANGAN menerjemahkan hookClassification ke bahasa lain'));
    assert.ok(prompt.includes('["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]'));

    // Segment formatting
    assert.ok(prompt.includes('[s1]: Banyak orang mengira sukses bisnis online itu cuma soal modal besar.'));
    assert.ok(prompt.includes('[s2] [Budi]: Padahal rahasia terbesarnya ada di cara membangun audiens sejak hari pertama.'));
    assert.ok(prompt.includes('Select exactly 2 viral highlight clips'));
  });

  await t.test('1.3 Mixed-language transcript handled gracefully with explicit and default language flags', () => {
    // With explicit English request on mixed transcript
    const promptEn = buildDiscreteSentencePrompt(sampleMixedSentences, 60, 1, { language: 'en' });
    assert.ok(promptEn.includes('LANGUAGE REQUIREMENTS:'));
    assert.ok(promptEn.includes('[s1]: So basically, mindset orang tentang AI saat ini masih agak keliru.'));

    // With explicit Indonesian request on mixed transcript
    const promptId = buildDiscreteSentencePrompt(sampleMixedSentences, 60, 1, { language: 'id' });
    assert.ok(promptId.includes('PETUNJUK BAHASA:'));

    // With empty options or undefined language (defaults to Indonesian)
    const promptDefault = buildDiscreteSentencePrompt(sampleMixedSentences, 60, 1, {});
    assert.ok(promptDefault.includes('PETUNJUK BAHASA:'));

    // With regional tag e.g. en-US, en-GB
    const promptRegionalEn = buildDiscreteSentencePrompt(sampleMixedSentences, 60, 1, { language: 'en-US' });
    assert.ok(promptRegionalEn.includes('LANGUAGE REQUIREMENTS:'));
  });

  await t.test('1.4 Invariant preservation: Exact string token contracts remain satisfied', () => {
    const promptEn = buildDiscreteSentencePrompt(sampleEnglishSentences, 60, 2, { language: 'en' });
    const promptId = buildDiscreteSentencePrompt(sampleIndonesianSentences, 60, 2, { language: 'id' });

    // Invariants required by multilingual.test.js
    assert.ok(promptEn.includes('LANGUAGE REQUIREMENTS:'));
    assert.ok(promptEn.includes('MUST be written in natural, engaging English'));
    assert.ok(promptEn.includes('STRICT TAXONOMY INVARIANT:'));
    assert.ok(promptEn.includes('["question", "bold_statement"'));

    assert.ok(promptId.includes('PETUNJUK BAHASA:'));
    assert.ok(promptId.includes('HARUS ditulis dalam bahasa Indonesia'));
    assert.ok(promptId.includes('STRICT TAXONOMY INVARIANT:'));
    assert.ok(promptId.includes('["question", "bold_statement"'));
  });

  await t.test('1.5 Edge cases: Empty arrays, invalid types, and special character transcripts', () => {
    // Empty array
    assert.throws(() => buildDiscreteSentencePrompt([], 60, 2), /non-empty array/);

    // Non-array input
    assert.throws(() => buildDiscreteSentencePrompt(null, 60, 2), /non-empty array/);
    assert.throws(() => buildDiscreteSentencePrompt('string', 60, 2), /non-empty array/);

    // Single sentence transcript
    const single = [{ id: 's1', index: 0, start: 0.0, end: 5.0, text: 'Just one sentence.' }];
    const pSingle = buildDiscreteSentencePrompt(single, 5.0, 1, { language: 'en' });
    assert.ok(pSingle.includes('Total sentences: 1.'));
    assert.ok(pSingle.includes('[s1]: Just one sentence.'));

    // Transcripts containing quotes, curly braces, and markdown characters
    const specialChars = [
      { id: 's1', index: 0, start: 0.0, end: 3.0, text: 'He said: "JSON uses { key: [1, 2, 3] } and ```code```".' },
      { id: 's2', index: 1, start: 3.0, end: 6.0, text: 'It also has & < > special HTML entities.' },
    ];
    const pSpecial = buildDiscreteSentencePrompt(specialChars, 6.0, 1, { language: 'en' });
    assert.ok(pSpecial.includes('He said: "JSON uses { key: [1, 2, 3] } and ```code```".'));
    assert.ok(pSpecial.includes('It also has & < > special HTML entities.'));
  });
});

// =========================================================================
// TEST GROUP 2: Payload Parsing (parseClipPayload) Empirical Stress Testing
// =========================================================================
test('Challenger 1 Suite: parseClipPayload Robustness with Hostile AI Outputs', async (t) => {
  await t.test('2.1 Standard clean JSON payloads (direct array and object with clips key)', () => {
    // Direct array
    const directArrayJson = JSON.stringify([
      { startSentenceId: 's1', endSentenceId: 's2', title: 'Direct Array Clip' },
    ]);
    const resArr = parseClipPayload(directArrayJson);
    assert.ok(Array.isArray(resArr));
    assert.strictEqual(resArr.length, 1);
    assert.strictEqual(resArr[0].title, 'Direct Array Clip');

    // Object with clips
    const objectWithClips = JSON.stringify({
      clips: [{ startSentenceId: 's1', endSentenceId: 's2', title: 'Object Clip' }],
    });
    const resObj = parseClipPayload(objectWithClips);
    assert.ok(Array.isArray(resObj));
    assert.strictEqual(resObj.length, 1);
    assert.strictEqual(resObj[0].title, 'Object Clip');
  });

  await t.test('2.2 Markdown code fences variations (```json, ```JSON, ``` without lang)', () => {
    const sampleBody = JSON.stringify({
      clips: [{ startSentenceId: 's1', endSentenceId: 's2', title: 'Fenced Clip' }],
    }, null, 2);

    // Standard ```json
    const fencedJson = '```json\n' + sampleBody + '\n```';
    assert.strictEqual(parseClipPayload(fencedJson)[0].title, 'Fenced Clip');

    // Uppercase ```JSON
    const fencedUpper = '```JSON\n' + sampleBody + '\n```';
    assert.strictEqual(parseClipPayload(fencedUpper)[0].title, 'Fenced Clip');

    // Plain ``` without language tag
    const fencedPlain = '```\n' + sampleBody + '\n```';
    assert.strictEqual(parseClipPayload(fencedPlain)[0].title, 'Fenced Clip');

    // Trailing/leading whitespace around fences
    const fencedSpaced = '   ```json\n' + sampleBody + '\n```   \n';
    assert.strictEqual(parseClipPayload(fencedSpaced)[0].title, 'Fenced Clip');
  });

  await t.test('2.3 Surrounding conversational banter with preamble and postamble', () => {
    const conversational = `
Here is my expert analysis of your podcast episode.
I selected the top viral highlight clips following your 4-pillar virality criteria:

\`\`\`json
{
  "clips": [
    {
      "startSentenceId": "s1",
      "endSentenceId": "s3",
      "title": "Why Startups Fail",
      "hookClassification": "question",
      "hookText": "Have you ever wondered why most startups fail?",
      "viralityScore": 95
    }
  ]
}
\`\`\`

I hope this helps your Shorts perform amazingly well! Let me know if you want adjustments.
`;

    const res = parseClipPayload(conversational);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].title, 'Why Startups Fail');
    assert.strictEqual(res[0].viralityScore, 95);
  });

  await t.test('2.4 Conversational text containing square brackets e.g. "I found [3 clips]"', () => {
    const textWithBrackets = `
I reviewed the transcript and found [3 high-impact clips] for your TikTok strategy:

{
  "clips": [
    {
      "startSentenceId": "s1",
      "endSentenceId": "s2",
      "title": "Hook Mastery",
      "hookClassification": "bold_statement"
    }
  ]
}

Bracket note: [End of response].
`;

    const res = parseClipPayload(textWithBrackets);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].title, 'Hook Mastery');
  });

  await t.test('2.5 Empty or invalid JSON payloads trigger descriptive errors', () => {
    assert.throws(() => parseClipPayload(''), /AI tidak mengembalikan konten/);
    assert.throws(() => parseClipPayload('   \n\t  '), /AI tidak mengembalikan konten/);
    assert.throws(() => parseClipPayload('This is purely conversational text with no JSON at all.'), /tidak mengembalikan format JSON yang valid/);
    assert.throws(() => parseClipPayload('{ "clips": "not-an-array" }'), /tidak mengembalikan format JSON yang valid/);
  });

  await t.test('2.6 Truncated / malformed JSON strings fail safely', () => {
    const truncated = '{"clips": [{"startSentenceId": "s1", "title": "Incomplete...';
    assert.throws(() => parseClipPayload(truncated), /tidak mengembalikan format JSON yang valid/);
  });

  await t.test('2.7 Complex characters, quotes, and unicode in clip titles and rationales', () => {
    const complexJson = `
{
  "clips": [
    {
      "startSentenceId": "s1",
      "endSentenceId": "s2",
      "title": "The \\"Secret\\" to 10x Growth 🔥",
      "hookClassification": "bold_statement",
      "hookText": "Here's what they won't tell you: it's not luck.",
      "viralityRationale": "Emotional tension & punchy resolution — 100% retention potential."
    }
  ]
}
`;
    const res = parseClipPayload(complexJson);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].title, 'The "Secret" to 10x Growth 🔥');
    assert.ok(res[0].viralityRationale.includes('Emotional tension'));
  });
});

// =========================================================================
// TEST GROUP 3: Clip Validation & Resolution Boundary Conditions
// =========================================================================
test('Challenger 1 Suite: validateClips and resolveSentenceIds Boundary Conditions', async (t) => {
  await t.test('3.1 validateClips: normal clips pass with duration clamping and default values', () => {
    const rawClips = [
      { start: 10.0, end: 45.0, title: 'Epic Breakthrough', score: 92, reason: 'High retention' },
      { start: 50.0, end: 85.0, title: 'Second Highlight', score: 88 },
    ];
    const validated = validateClips(rawClips, 100, 3, 'en');
    assert.strictEqual(validated.length, 2);
    assert.strictEqual(validated[0].start, 10.0);
    assert.strictEqual(validated[0].end, 45.0);
    assert.strictEqual(validated[0].title, 'Epic Breakthrough');
    assert.strictEqual(validated[0].score, 92);
    assert.strictEqual(validated[1].reason, '');
  });

  await t.test('3.2 validateClips: clips with duration < 10 seconds are strictly rejected', () => {
    const shortClips = [
      { start: 10.0, end: 15.0, title: 'Too Short 5s', score: 90 },
      { start: 20.0, end: 29.99, title: 'Too Short 9.99s', score: 90 },
      { start: 30.0, end: 40.0, title: 'Valid 10s Exact', score: 90 },
    ];
    const validated = validateClips(shortClips, 100, 3, 'en');
    assert.strictEqual(validated.length, 1, 'Only the 10.0s clip should be accepted');
    assert.strictEqual(validated[0].title, 'Valid 10s Exact');
  });

  await t.test('3.3 validateClips: inverted timestamps (start > end) are rejected', () => {
    const inverted = [
      { start: 45.0, end: 15.0, title: 'Inverted Range', score: 85 },
      { start: 50.0, end: 50.0, title: 'Zero Duration', score: 85 },
    ];
    const validated = validateClips(inverted, 100, 3, 'en');
    assert.strictEqual(validated.length, 0, 'Inverted and zero duration clips must be rejected');
  });

  await t.test('3.4 validateClips: timestamps clamped to [0, videoDuration]', () => {
    const outOfBounds = [
      { start: -10.0, end: 35.0, title: 'Negative Start', score: 80 },
      { start: 60.0, end: 150.0, title: 'End Exceeds Video Duration', score: 80 },
    ];
    const validated = validateClips(outOfBounds, 100, 3, 'en');
    assert.strictEqual(validated.length, 2);
    assert.strictEqual(validated[0].start, 0.0, 'Negative start must be clamped to 0');
    assert.strictEqual(validated[0].end, 35.0);
    assert.strictEqual(validated[1].start, 60.0);
    assert.strictEqual(validated[1].end, 100.0, 'End beyond video duration must be clamped to 100');
  });

  await t.test('3.5 validateClips: non-numeric string timestamps are rejected', () => {
    const stringTimestamps = [
      { start: '10.0', end: '40.0', title: 'String Timestamps', score: 85 },
      { start: null, end: 40.0, title: 'Null Start', score: 85 },
      { start: 10.0, end: undefined, title: 'Undefined End', score: 85 },
    ];
    const validated = validateClips(stringTimestamps, 100, 3, 'en');
    assert.strictEqual(validated.length, 0, 'String and null timestamps must be filtered out');
  });

  await t.test('3.6 validateClips: fallback title respects detected language', () => {
    const noTitleClip = [{ start: 10.0, end: 40.0, score: 85 }];
    const valEn = validateClips(noTitleClip, 100, 3, 'en');
    const valId = validateClips(noTitleClip, 100, 3, 'id');
    assert.strictEqual(valEn[0].title, 'Compelling Clip', 'English fallback must be Compelling Clip');
    assert.strictEqual(valId[0].title, 'Clip Menarik', 'Indonesian fallback must be Clip Menarik');
  });

  await t.test('3.7 validateClips: score boundary evaluation and zero-score fallback behavior', () => {
    const clips = [
      { start: 10.0, end: 40.0, title: 'Score 100', score: 100 },
      { start: 10.0, end: 40.0, title: 'Score 150', score: 150 }, // Clamped to 100
      { start: 10.0, end: 40.0, title: 'Score Negative', score: -20 }, // Clamped to 0
      { start: 10.0, end: 40.0, title: 'Score Missing', score: undefined }, // Defaults to 80
      { start: 10.0, end: 40.0, title: 'Score Zero', score: 0 }, // Evaluates 0 || 80 -> 80
    ];
    const validated = validateClips(clips, 100, 5, 'en');
    assert.strictEqual(validated[0].score, 100);
    assert.strictEqual(validated[1].score, 100, 'Score 150 clamped to 100');
    assert.strictEqual(validated[2].score, 0, 'Negative score clamped to 0');
    assert.strictEqual(validated[3].score, 80, 'Missing score defaults to 80');
    // Note: parseInt(0, 10) || 80 in JS evaluates to 80 because 0 is falsy
    assert.strictEqual(validated[4].score, 80, 'Empirical note: score 0 evaluates to 80 due to || operator');
  });

  await t.test('3.8 validateClips: clipCount limits number of returned clips', () => {
    const clips = [
      { start: 10.0, end: 40.0, title: 'Clip 1', score: 90 },
      { start: 40.0, end: 70.0, title: 'Clip 2', score: 85 },
      { start: 70.0, end: 95.0, title: 'Clip 3', score: 80 },
    ];
    const validated = validateClips(clips, 100, 2, 'en');
    assert.strictEqual(validated.length, 2, 'Must slice to requested clipCount (2)');
    assert.strictEqual(validated[0].title, 'Clip 1');
    assert.strictEqual(validated[1].title, 'Clip 2');
  });

  await t.test('3.9 resolveSentenceIds: case-insensitivity, normalization, and pre-snapping', () => {
    // Standard s1 to s3
    const clip1 = {
      startSentenceId: 's1',
      endSentenceId: 's3',
      title: 'Full Arc',
      hookClassification: 'question',
      viralityScore: 90,
    };
    const resolved1 = resolveSentenceIds(clip1, sentenceMap, { sentences: sampleEnglishSentences, language: 'en' });
    assert.strictEqual(resolved1.resolvedSentences.count, 3);
    assert.ok(typeof resolved1.start === 'number');
    assert.ok(typeof resolved1.end === 'number');
    assert.ok(resolved1.end > resolved1.start);
    assert.strictEqual(resolved1.title, 'Full Arc');

    // Case and format normalization: [s1], S2, 1
    const clipNormalized = {
      startSentenceId: '[S1]',
      endSentenceId: 's02',
    };
    const resolvedNorm = resolveSentenceIds(clipNormalized, sentenceMap, { sentences: sampleEnglishSentences, language: 'en' });
    assert.strictEqual(resolvedNorm.resolvedSentences.count, 2);
    assert.strictEqual(resolvedNorm.title, 'Compelling Clip'); // Fallback title
  });

  await t.test('3.10 resolveSentenceIds: error on missing or inverted sentence IDs', () => {
    // Missing ID
    assert.throws(
      () => resolveSentenceIds({ startSentenceId: 's999', endSentenceId: 's2' }, sentenceMap),
      /not found in sentence map/
    );
    assert.throws(
      () => resolveSentenceIds({ startSentenceId: 's1', endSentenceId: 's999' }, sentenceMap),
      /not found in sentence map/
    );

    // Inverted IDs (s3 to s1)
    assert.throws(
      () => resolveSentenceIds({ startSentenceId: 's3', endSentenceId: 's1' }, sentenceMap),
      /cannot be after/
    );

    // Invalid clip input
    assert.throws(() => resolveSentenceIds(null, sentenceMap), /Invalid clip object/);
    assert.throws(() => resolveSentenceIds('not an object', sentenceMap), /Invalid clip object/);
  });

  await t.test('3.11 validateNarrativeClipSchema: accepts valid 4-pillar narrative clips and rejects invalid', () => {
    const validClip = {
      title: 'The Great Startup Filter',
      hookClassification: 'question',
      hookText: 'Have you ever wondered why most startups fail within the first year?',
      narrativeRationale: {
        setup: 'Explaining high startup failure rates.',
        climax: 'Revealing the lack of customer feedback loop as root cause.',
        conclusion: 'Iterative feedback produces immediate customer retention.',
        isCompleteArc: true,
      },
      viralityScore: 95,
      viralityRationale: 'Immediate 0-3s curiosity gap, rapid pacing, strong retention, clear actionable payoff.',
    };

    const validResult = validateNarrativeClipSchema(validClip);
    assert.strictEqual(validResult.valid, true);

    // Reject non-numeric viralityScore
    assert.strictEqual(validateNarrativeClipSchema({ ...validClip, viralityScore: '95' }).valid, false);
    assert.strictEqual(validateNarrativeClipSchema({ ...validClip, viralityScore: -5 }).valid, false);
    assert.strictEqual(validateNarrativeClipSchema({ ...validClip, viralityScore: 105 }).valid, false);

    // Reject empty viralityRationale
    assert.strictEqual(validateNarrativeClipSchema({ ...validClip, viralityRationale: '  ' }).valid, false);

    // Reject invalid hook classification
    assert.strictEqual(validateNarrativeClipSchema({ ...validClip, hookClassification: 'viral_hook' }).valid, false);
  });
});

// =========================================================================
// TEST GROUP 4: Architectural & Model Configuration Verification
// =========================================================================
test('Challenger 1 Suite: Architectural Export & Model Configuration Conformance', async (t) => {
  await t.test('4.1 AI model resolves from configuration (provider-neutral)', () => {
    // DEFAULT_AI_MODEL is a provider-neutral placeholder; the effective model
    // always comes from env configuration.
    assert.strictEqual(typeof DEFAULT_AI_MODEL, 'string');
    assert.ok(DEFAULT_AI_MODEL.length > 0, 'DEFAULT_AI_MODEL must be a non-empty string');

    const config = resolveModelConfiguration();
    const expectedModel =
      process.env.DEFAULT_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL;
    assert.strictEqual(
      config.model,
      expectedModel,
      `Resolved model (${config.model}) must match env override or DEFAULT_AI_MODEL`
    );
  });

  await t.test('4.2 Multi-tier candidate builder generates resilient gateway list', () => {
    const candidates = buildGatewayCandidates();
    assert.ok(Array.isArray(candidates));
    assert.ok(candidates.length >= 1, 'Should have at least 1 gateway candidate');
    assert.strictEqual(candidates[0].label, 'primary-gateway');

    // Primary candidate MUST resolve to the effective configured model — which is
    // process.env.DEFAULT_MODEL (env override) when set, otherwise DEFAULT_AI_MODEL.
    // Do NOT hardcode a provider name here: the model is user-configurable.
    const expectedPrimaryModel =
      process.env.DEFAULT_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL;
    assert.strictEqual(
      candidates[0].model,
      expectedPrimaryModel,
      `Primary gateway model (${candidates[0].model}) must match resolved config (${expectedPrimaryModel})`
    );

    // Every candidate must carry a usable model identifier (non-empty string).
    for (const c of candidates) {
      assert.strictEqual(typeof c.model, 'string');
      assert.ok(c.model.length > 0, 'Each candidate must have a non-empty model');
    }
  });

  await t.test('4.3 Architectural Finding: Check exported helper functions', () => {
    // Assert which public API functions are exported
    assert.strictEqual(typeof analyzerModule.buildDiscreteSentencePrompt, 'function');
    assert.strictEqual(typeof analyzerModule.resolveSentenceIds, 'function');
    assert.strictEqual(typeof analyzerModule.validateNarrativeClipSchema, 'function');
    assert.strictEqual(typeof analyzerModule.resolveModelConfiguration, 'function');
    assert.strictEqual(typeof analyzerModule.buildGatewayCandidates, 'function');
    assert.strictEqual(typeof analyzerModule.analyzeTranscript, 'function');

    // Note whether parseClipPayload and validateClips are exported
    const isParseExported = typeof analyzerModule.parseClipPayload === 'function';
    const isValidateExported = typeof analyzerModule.validateClips === 'function';

    // We verify this state empirically: they are currently internal functions
    console.log(`ℹ [Challenger Finding] parseClipPayload exported: ${isParseExported}`);
    console.log(`ℹ [Challenger Finding] validateClips exported: ${isValidateExported}`);
  });
});
