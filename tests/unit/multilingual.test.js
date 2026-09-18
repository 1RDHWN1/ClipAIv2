// tests/unit/multilingual.test.js
import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeLanguageCode,
  detectLanguageFromText,
  normalizeToUnifiedTranscript,
} from '../../utils/transcriber.js';
import {
  selectTargetSubtitleFile,
} from '../../utils/downloader.js';
import {
  segmentWordsIntoSentences,
} from '../../utils/sentenceSegmenter.js';
import {
  buildDiscreteSentencePrompt,
  resolveSentenceIds,
  validateNarrativeClipSchema,
  VALID_HOOK_TAXONOMY,
} from '../../utils/analyzer.js';
import { parseGeminiTranscript } from '../../utils/geminiTranscriptParser.js';
import { abbreviationWords } from '../fixtures/mockTranscripts.js';

/**
 * Universal Multilingual Processing Test Suite
 * Requirements: ORIGINAL_REQUEST.md §R1, §R2, §R3, §R4
 *
 * Invariants:
 *  1. Dynamic Language Detection: Normalize and auto-detect English ('en') and Indonesian ('id').
 *  2. Resilient Sentence Segmentation: No premature splits at English and Indonesian abbreviations.
 *  3. Language-Adaptive Prompting: Generates native English / Indonesian prompts while preserving
 *     normalized hookClassification in VALID_HOOK_TAXONOMY.
 */

test('Universal Multilingual - Language Normalization & Detection (R1)', async (t) => {
  await t.test('Case 1: normalizeLanguageCode maps full language names to ISO-639-1', () => {
    assert.strictEqual(normalizeLanguageCode('english'), 'en');
    assert.strictEqual(normalizeLanguageCode('indonesian'), 'id');
    assert.strictEqual(normalizeLanguageCode('spanish'), 'es');
    assert.strictEqual(normalizeLanguageCode('french'), 'fr');
    assert.strictEqual(normalizeLanguageCode('german'), 'de');
    assert.strictEqual(normalizeLanguageCode('japanese'), 'ja');
  });

  await t.test('Case 2: normalizeLanguageCode handles regional BCP-47 and YouTube sub tags', () => {
    assert.strictEqual(normalizeLanguageCode('en_us'), 'en');
    assert.strictEqual(normalizeLanguageCode('en-US'), 'en');
    assert.strictEqual(normalizeLanguageCode('en-GB'), 'en');
    assert.strictEqual(normalizeLanguageCode('id_ID'), 'id');
    assert.strictEqual(normalizeLanguageCode('en-orig'), 'en');
    assert.strictEqual(normalizeLanguageCode('id-orig'), 'id');
  });

  await t.test('Case 3: normalizeLanguageCode gracefully handles invalid or missing inputs', () => {
    assert.strictEqual(normalizeLanguageCode(null), 'unknown');
    assert.strictEqual(normalizeLanguageCode(undefined), 'unknown');
    assert.strictEqual(normalizeLanguageCode(''), 'unknown');
    assert.strictEqual(normalizeLanguageCode(123), 'unknown');
  });

  await t.test('Case 4: detectLanguageFromText correctly identifies English text', () => {
    const enText = 'The quick brown fox jumps over the lazy dog and this is a truly great podcast about artificial intelligence.';
    assert.strictEqual(detectLanguageFromText(enText), 'en');
    const enConversational = "Yo, this is crazy, y'all. Yeah, bro, look at this!";
    assert.strictEqual(detectLanguageFromText(enConversational), 'en');
  });

  await t.test('Case 5: detectLanguageFromText correctly identifies Indonesian text', () => {
    const idText = 'Halo semuanya, selamat datang di video podcast kami yang sangat luar biasa dan menarik ini.';
    assert.strictEqual(detectLanguageFromText(idText), 'id');
    const idConversational = 'Gak gitu juga kali bro, emang beneran nih? Udah gak sabar banget.';
    assert.strictEqual(detectLanguageFromText(idConversational), 'id');
  });

  await t.test('Case 6: detectLanguageFromText falls back to id for empty or neutral inputs', () => {
    assert.strictEqual(detectLanguageFromText(''), 'id');
    assert.strictEqual(detectLanguageFromText(null), 'id');
    assert.strictEqual(detectLanguageFromText('123 456 789'), 'id');
    assert.strictEqual(detectLanguageFromText('123 456 789', 'en'), 'en');
  });

  await t.test('Case 7: normalizeToUnifiedTranscript auto-detects language when unset or auto', async () => {
    const enWords = [
      { word: 'This', start: 0.0, end: 0.3 },
      { word: 'is', start: 0.35, end: 0.6 },
      { word: 'a', start: 0.65, end: 0.8 },
      { word: 'great', start: 0.85, end: 1.2 },
      { word: 'conversation', start: 1.25, end: 1.8 },
      { word: 'about', start: 1.85, end: 2.1 },
      { word: 'technology.', start: 2.15, end: 2.7 },
    ];
    const enTranscript = await normalizeToUnifiedTranscript({ words: enWords, language: 'auto' });
    assert.strictEqual(enTranscript.language, 'en', 'English text should be auto-detected as en');

    const idWords = [
      { word: 'Ini', start: 0.0, end: 0.3 },
      { word: 'adalah', start: 0.35, end: 0.6 },
      { word: 'percakapan', start: 0.65, end: 1.1 },
      { word: 'yang', start: 1.15, end: 1.4 },
      { word: 'sangat', start: 1.45, end: 1.8 },
      { word: 'menarik.', start: 1.85, end: 2.4 },
    ];
    const idTranscript = await normalizeToUnifiedTranscript({ words: idWords });
    assert.strictEqual(idTranscript.language, 'id', 'Indonesian text should be auto-detected as id');
  });

  await t.test('Case 8: normalizeToUnifiedTranscript preserves explicit language override', async () => {
    const words = [{ word: 'Hello', start: 0.0, end: 0.5 }, { word: 'world.', start: 0.6, end: 1.0 }];
    const transcript = await normalizeToUnifiedTranscript({ words, language: 'en-US' });
    assert.strictEqual(transcript.language, 'en', 'Explicit en-US should be normalized to en');
  });

  await t.test('Case 9: selectTargetSubtitleFile prioritizes spoken original track (*-orig) over non-orig auto-translations', () => {
    const files = ['job123_sub.id.json3', 'job123_sub.en-orig.json3', 'job123_sub.en.json3'];
    // Even when preferredLang is 'id', en-orig MUST be chosen because it is the original audio of the English video!
    assert.strictEqual(selectTargetSubtitleFile(files, 'id'), 'job123_sub.en-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto'), 'job123_sub.en-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'en'), 'job123_sub.en-orig.json3');
  });

  await t.test('Case 10: selectTargetSubtitleFile prioritizes id-orig for Indonesian video even when preferredLang is en', () => {
    const files = ['job456_sub.en.json3', 'job456_sub.id-orig.json3', 'job456_sub.id.json3'];
    assert.strictEqual(selectTargetSubtitleFile(files, 'en'), 'job456_sub.id-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto'), 'job456_sub.id-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'id'), 'job456_sub.id-orig.json3');
  });

  await t.test('Case 11: selectTargetSubtitleFile respects preferredLang when only manual subtitles without -orig are present', () => {
    const files = ['job789_sub.id.json3', 'job789_sub.en.json3'];
    assert.strictEqual(selectTargetSubtitleFile(files, 'en'), 'job789_sub.en.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'id'), 'job789_sub.id.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto'), 'job789_sub.id.json3');
  });

  await t.test('Case 12: selectTargetSubtitleFile handles empty, non-array or invalid inputs gracefully', () => {
    assert.strictEqual(selectTargetSubtitleFile([]), null);
    assert.strictEqual(selectTargetSubtitleFile(null), null);
    assert.strictEqual(selectTargetSubtitleFile(undefined), null);
  });

  await t.test('Case 13: selectTargetSubtitleFile respects videoLang when preferredLang is auto', () => {
    const files = ['job789_sub.id.json3', 'job789_sub.en.json3'];
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto', 'en'), 'job789_sub.en.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto', 'id'), 'job789_sub.id.json3');
  });

  await t.test('Case 14: selectTargetSubtitleFile prioritizes matching language *-orig when multiple orig tracks exist', () => {
    const files = ['sub.es-orig.json3', 'sub.en-orig.json3'];
    assert.strictEqual(selectTargetSubtitleFile(files, 'auto', 'en'), 'sub.en-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'en'), 'sub.en-orig.json3');
    assert.strictEqual(selectTargetSubtitleFile(files, 'es'), 'sub.es-orig.json3');
  });
});

test('Universal Multilingual - Abbreviation Resilience in Segmentation (R2)', async (t) => {
  function makeWords(tokenList) {
    return tokenList.map((token, idx) => ({
      word: token,
      start: parseFloat((idx * 0.5).toFixed(3)),
      end: parseFloat((idx * 0.5 + 0.4).toFixed(3)),
    }));
  }

  await t.test('Case 1: English abbreviations (Mr., Mrs., Dr., e.g., i.e., Inc., vs.) do not trigger sentence splits', () => {
    const tokens = [
      'Dr.', 'Smith', 'and', 'Mrs.', 'Davis', 'from', 'Apple', 'Inc.',
      'met', 'Mr.', 'Jones', 'vs.', 'competitors', 'e.g.,', 'Samsung', 'i.e.,', 'rivals.'
    ];
    const sentences = segmentWordsIntoSentences(makeWords(tokens));
    assert.strictEqual(sentences.length, 1, 'Sentence containing English abbreviations must not split prematurely');
    assert.ok(sentences[0].text.includes('Apple Inc.'));
    assert.ok(sentences[0].text.includes('Dr. Smith'));
    assert.ok(sentences[0].text.includes('Mr. Jones'));
  });

  await t.test('Case 2: Indonesian abbreviations (Bpk., PT., dsb., dll., Yth., Jl.) do not trigger sentence splits', () => {
    const tokens = [
      'Kepada', 'Yth.', 'Bpk.', 'Joko', 'dari', 'PT.', 'Telkom', 'di',
      'Jl.', 'Sudirman', 'membawa', 'dokumen,', 'dsb.', 'dan', 'arsip', 'dll.', 'ke', 'kantor.'
    ];
    const sentences = segmentWordsIntoSentences(makeWords(tokens));
    assert.strictEqual(sentences.length, 1, 'Sentence containing Indonesian abbreviations must not split prematurely');
    assert.ok(sentences[0].text.includes('Bpk. Joko'));
    assert.ok(sentences[0].text.includes('PT. Telkom'));
    assert.ok(sentences[0].text.includes('dsb.'));
    assert.ok(sentences[0].text.includes('dll.'));
  });

  await t.test('Case 3: Indonesian titles (Ibu., Sdr., Ir., Drs., Ust.) do not trigger sentence splits', () => {
    const tokens = ['Ibu.', 'Siti', 'dan', 'Ir.', 'Budi', 'serta', 'Ust.', 'Ahmad', 'hadir', 'bersama.'];
    const sentences = segmentWordsIntoSentences(makeWords(tokens));
    assert.strictEqual(sentences.length, 1, 'Indonesian titles must not split sentence');
  });

  await t.test('Case 4: Version numbers with multiple dots (e.g. 2.0.1) do not trigger false splits', () => {
    const tokens = ['Versi', 'aplikasi', '2.0.1', 'telah', 'resmi', 'dirilis', 'kemarin.'];
    const sentences = segmentWordsIntoSentences(makeWords(tokens));
    assert.strictEqual(sentences.length, 1, 'Multi-dot version 2.0.1 should not split');
    assert.ok(sentences[0].text.includes('2.0.1'));
  });

  await t.test('Case 5: Contextual No. followed by digits vs text', () => {
    const numberedTokens = ['Pemenang', 'pertama', 'adalah', 'No.', '10', 'pada', 'malam', 'ini.'];
    const s1 = segmentWordsIntoSentences(makeWords(numberedTokens));
    assert.strictEqual(s1.length, 1, 'No. followed by digits is an abbreviation');

    const splitTokens = ['No.', 'We', 'cannot', 'agree', 'with', 'that', 'proposal.'];
    const s2 = segmentWordsIntoSentences(makeWords(splitTokens));
    assert.strictEqual(s2.length, 2, 'No. followed by capitalized text is a terminal sentence');
    assert.strictEqual(s2[0].text, 'No.');
  });

  await t.test('Case 6: Existing fixture abbreviationWords continues to produce exactly 2 sentences', () => {
    const sentences = segmentWordsIntoSentences(abbreviationWords);
    assert.strictEqual(sentences.length, 2, 'Dr. Smith visited the U.S. at 3.14 PM. It was great. must produce 2 sentences');
    assert.ok(sentences[0].text.includes('Dr. Smith visited the U.S. at 3.14 PM.'));
    assert.ok(sentences[1].text.includes('It was great.'));
  });
});

test('Universal Multilingual - Language-Adaptive Narrative Prompting (R3)', async (t) => {
  const dummySentences = [
    { id: 's1', index: 0, start: 0.0, end: 2.0, text: 'Welcome everyone to the tech showcase.' },
    { id: 's2', index: 1, start: 2.2, end: 4.5, text: 'Today we reveal our breakthrough quantum chip.' },
    { id: 's3', index: 2, start: 4.7, end: 7.0, text: 'It outperforms existing supercomputers by tenfold.' },
  ];

  await t.test('Case 1: buildDiscreteSentencePrompt with language: en produces English instructions', () => {
    const prompt = buildDiscreteSentencePrompt(dummySentences, 10.0, 1, { language: 'en' });
    assert.ok(prompt.includes('LANGUAGE REQUIREMENTS:'), 'Prompt should have English section header');
    assert.ok(prompt.includes('MUST be written in natural, engaging English'), 'Prompt instructs natural English');
    assert.ok(prompt.includes('STRICT TAXONOMY INVARIANT:'), 'Prompt enforces taxonomy invariant');
    assert.ok(prompt.includes('["question", "bold_statement"'), 'Prompt specifies exact taxonomy strings');
  });

  await t.test('Case 2: buildDiscreteSentencePrompt with language: id produces Indonesian instructions', () => {
    const prompt = buildDiscreteSentencePrompt(dummySentences, 10.0, 1, { language: 'id' });
    assert.ok(prompt.includes('PETUNJUK BAHASA:'), 'Prompt should have Indonesian section header');
    assert.ok(prompt.includes('HARUS ditulis dalam bahasa Indonesia'), 'Prompt instructs natural Indonesian');
    assert.ok(prompt.includes('STRICT TAXONOMY INVARIANT:'), 'Prompt enforces taxonomy invariant');
    assert.ok(prompt.includes('["question", "bold_statement"'), 'Prompt specifies exact taxonomy strings');
  });

  await t.test('Case 3: Fallback title produces Compelling Clip for en and Clip Menarik for id', () => {
    const map = new Map([
      ['s1', dummySentences[0]],
      ['s2', dummySentences[1]],
      ['s3', dummySentences[2]],
    ]);

    const rawClipNoTitle = {
      startSentenceId: 's1',
      endSentenceId: 's2',
      hookClassification: 'question',
      hookText: 'Welcome everyone',
      viralityScore: 85,
    };

    const resolvedEn = resolveSentenceIds(rawClipNoTitle, map, {
      sentences: dummySentences,
      language: 'en',
    });
    assert.strictEqual(resolvedEn.title, 'Compelling Clip', 'Default title for English must be Compelling Clip');

    const resolvedId = resolveSentenceIds(rawClipNoTitle, map, {
      sentences: dummySentences,
      language: 'id',
    });
    assert.strictEqual(resolvedId.title, 'Clip Menarik', 'Default title for Indonesian must be Clip Menarik');
  });

  await t.test('Case 4: VALID_HOOK_TAXONOMY contains exactly the 6 normalized English classes', () => {
    assert.strictEqual(VALID_HOOK_TAXONOMY.length, 6);
    assert.deepStrictEqual(VALID_HOOK_TAXONOMY, [
      'question',
      'bold_statement',
      'negative_hook',
      'story_anecdote',
      'shocking_fact',
      'action_instruction',
    ]);
  });

  await t.test('Case 5: validateNarrativeClipSchema accepts all 6 valid taxonomy strings', () => {
    for (const hook of VALID_HOOK_TAXONOMY) {
      const clip = {
        title: 'Great Clip',
        hookClassification: hook,
        hookText: 'Did you know this?',
        narrativeRationale: {
          setup: 'Intro',
          climax: 'Turning point',
          conclusion: 'Outro',
          isCompleteArc: true,
        },
        viralityScore: 90,
        viralityRationale: 'High engagement',
      };
      const result = validateNarrativeClipSchema(clip);
      assert.strictEqual(result.valid, true, `Hook "${hook}" must be accepted`);
    }
  });

  await t.test('Case 6: validateNarrativeClipSchema strictly rejects translated or non-conforming hook taxonomy', () => {
    const invalidHooks = [
      'pertanyaan',          // Indonesian translation of question
      'pernyataan_tegas',    // Indonesian translation of bold_statement
      'hook_negatif',        // Indonesian translation of negative_hook
      'fakta_mengejutkan',   // Indonesian translation of shocking_fact
      'QUESTION',            // Uppercase
      'Bold_Statement',      // Mixed case
      'random_hook',         // Unknown
    ];

    for (const badHook of invalidHooks) {
      const clip = {
        title: 'Clip Title',
        hookClassification: badHook,
        hookText: 'Some hook text',
        narrativeRationale: { setup: 's', climax: 'c', conclusion: 'o', isCompleteArc: true },
        viralityScore: 80,
        viralityRationale: 'Reason',
      };
      const result = validateNarrativeClipSchema(clip);
      assert.strictEqual(result.valid, false, `Non-normalized hook "${badHook}" must be rejected`);
      assert.ok(result.reason.includes('Invalid or missing hookClassification'));
    }
  });
});

test('Universal Multilingual - Gemini Transcript Parser Language Detection (R1)', async (t) => {
  await t.test('Case 1: parseGeminiTranscript auto-detects English language transcript', () => {
    const enMarkdown = `
([0:00](https://www.youtube.com/watch?v=xyz&t=0s)) Welcome to our special podcast.
([0:05](https://www.youtube.com/watch?v=xyz&t=5s)) Today we discuss the future of technology and computing.
([0:12](https://www.youtube.com/watch?v=xyz&t=12s)) It is a very exciting journey.
`;
    const result = parseGeminiTranscript(enMarkdown, { totalDuration: 20 });
    assert.strictEqual(result.language, 'en', 'Gemini English transcript must be tagged language: en');
    assert.strictEqual(result.sentences.length, 3);
  });

  await t.test('Case 2: parseGeminiTranscript auto-detects Indonesian language transcript', () => {
    const idMarkdown = `
([0:00](https://www.youtube.com/watch?v=xyz&t=0s)) Selamat datang di acara podcast kami.
([0:05](https://www.youtube.com/watch?v=xyz&t=5s)) Hari ini kita akan membahas masa depan kecerdasan buatan.
([0:12](https://www.youtube.com/watch?v=xyz&t=12s)) Ini adalah perjalanan yang sangat menarik.
`;
    const result = parseGeminiTranscript(idMarkdown, { totalDuration: 20 });
    assert.strictEqual(result.language, 'id', 'Gemini Indonesian transcript must be tagged language: id');
    assert.strictEqual(result.sentences.length, 3);
  });

  await t.test('Case 3: parseGeminiTranscript respects explicit language option', () => {
    const text = `
0:00 Hello and welcome everyone.
0:05 This is an awesome show.
`;
    const result = parseGeminiTranscript(text, { language: 'id', totalDuration: 10 });
    assert.strictEqual(result.language, 'id', 'Explicit option overrides auto-detection');
  });
});
