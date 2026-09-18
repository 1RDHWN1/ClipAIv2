// tests/unit/challenger_m1_2.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  segmentWordsIntoSentences,
  buildSentenceMap,
  findSentenceAtTime,
} from '../../utils/sentenceSegmenter.js';
import {
  detectAcousticSilence,
  detectLinguisticSilence,
  mergeSilenceIntervals,
  detectSilence,
} from '../../utils/silenceDetector.js';

/**
 * Challenger 2 Empirical Test Suite: Linguistic & Acoustic Robustness
 * Milestone: M1 (Features F2 & F3)
 * Target modules: utils/sentenceSegmenter.js, utils/silenceDetector.js
 */

const FIXTURES_DIR = path.resolve('tests/fixtures/media');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
    p.on('error', reject);
  });
}

test('Challenger 2 Suite: Linguistic Segmentation Edge Cases', async (t) => {
  await t.test('1.1 Extreme terminal punctuation combinations ("What?!?", "No...", "What!?!")', () => {
    const words = [
      { word: 'What?!?', start: 1.0, end: 1.4 },
      { word: 'Are', start: 1.5, end: 1.7 },
      { word: 'you', start: 1.75, end: 1.9 },
      { word: 'sure!?!', start: 1.95, end: 2.3 },
      { word: 'No...', start: 2.4, end: 2.7 },
      { word: 'I', start: 2.8, end: 2.9 },
      { word: 'cannot.', start: 2.95, end: 3.3 },
    ];

    const sentences = segmentWordsIntoSentences(words);
    assert.strictEqual(sentences.length, 4, 'Should segment into 4 discrete sentences');
    assert.strictEqual(sentences[0].text, 'What?!?');
    assert.strictEqual(sentences[1].text, 'Are you sure!?!');
    assert.strictEqual(sentences[2].text, 'No...');
    assert.strictEqual(sentences[3].text, 'I cannot.');
  });

  await t.test('1.2 Abbreviations and complex sentence ("e.g. at 5 p.m. Dr. Smith said...")', () => {
    const words = [
      { word: 'e.g.', start: 1.0, end: 1.3 },
      { word: 'at', start: 1.35, end: 1.5 },
      { word: '5', start: 1.55, end: 1.7 },
      { word: 'p.m.', start: 1.75, end: 2.0 },
      { word: 'Dr.', start: 2.05, end: 2.3 },
      { word: 'Smith', start: 2.35, end: 2.6 },
      { word: 'said...', start: 2.65, end: 3.0 },
      { word: 'We', start: 3.1, end: 3.3 },
      { word: 'must', start: 3.35, end: 3.5 },
      { word: 'proceed.', start: 3.55, end: 3.8 },
    ];

    const sentences = segmentWordsIntoSentences(words);
    assert.strictEqual(sentences.length, 2, 'Should not split on e.g., p.m., or Dr.; splits at said...');
    assert.strictEqual(sentences[0].text, 'e.g. at 5 p.m. Dr. Smith said...');
    assert.strictEqual(sentences[1].text, 'We must proceed.');
  });

  await t.test('1.3 Numeric versioning and decimals ("version 2.0.1")', () => {
    // 2.0.1 in the middle of a sentence must not split
    const midSentenceWords = [
      { word: 'We', start: 1.0, end: 1.2 },
      { word: 'deployed', start: 1.25, end: 1.6 },
      { word: 'version', start: 1.65, end: 2.0 },
      { word: '2.0.1', start: 2.05, end: 2.4 },
      { word: 'yesterday.', start: 2.45, end: 2.9 },
    ];
    const sMid = segmentWordsIntoSentences(midSentenceWords);
    assert.strictEqual(sMid.length, 1);
    assert.strictEqual(sMid[0].text, 'We deployed version 2.0.1 yesterday.');

    // 2.0.1. at sentence end must trigger boundary
    const endSentenceWords = [
      { word: 'Use', start: 1.0, end: 1.2 },
      { word: 'version', start: 1.25, end: 1.6 },
      { word: '2.0.1.', start: 1.65, end: 2.0 },
      { word: 'It', start: 2.1, end: 2.3 },
      { word: 'is', start: 2.35, end: 2.5 },
      { word: 'stable.', start: 2.55, end: 2.9 },
    ];
    const sEnd = segmentWordsIntoSentences(endSentenceWords);
    assert.strictEqual(sEnd.length, 2);
    assert.strictEqual(sEnd[0].text, 'Use version 2.0.1.');
    assert.strictEqual(sEnd[1].text, 'It is stable.');
  });

  await t.test('1.4 Rapid speaker switching: alternating speaker on every single word', () => {
    const alternating = [
      { word: 'Hey', start: 0.0, end: 0.3, speaker: 'Alice' },
      { word: 'what', start: 0.35, end: 0.6, speaker: 'Bob' },
      { word: 'is', start: 0.65, end: 0.9, speaker: 'Alice' },
      { word: 'up', start: 0.95, end: 1.2, speaker: 'Bob' },
      { word: 'now', start: 1.25, end: 1.5, speaker: 'Alice' },
      { word: 'today?', start: 1.55, end: 1.9, speaker: 'Bob' },
    ];

    const sentences = segmentWordsIntoSentences(alternating);
    assert.strictEqual(sentences.length, 6, 'Every word switch must produce a new sentence segment');
    for (let i = 0; i < sentences.length; i++) {
      assert.strictEqual(sentences[i].id, `s${i + 1}`);
      assert.strictEqual(sentences[i].speaker, alternating[i].speaker);
      assert.strictEqual(sentences[i].text, alternating[i].word);
    }
  });

  await t.test('1.5 Linguistic Bug Fixed: "No." terminal split recognized', () => {
    // In English speech, "No." is an affirmative rejection sentence.
    // When pause < 0.8s, "No. I refuse." splits after "No." because "No." is followed by non-digit.
    const words = [
      { word: 'No.', start: 1.0, end: 1.3 },
      { word: 'I', start: 1.4, end: 1.6 },
      { word: 'refuse.', start: 1.65, end: 2.0 },
    ];
    const sentences = segmentWordsIntoSentences(words);
    assert.strictEqual(sentences.length, 2, 'Should split into 2 discrete sentences');
    assert.strictEqual(sentences[0].text, 'No.');
    assert.strictEqual(sentences[1].text, 'I refuse.');
  });

  await t.test('1.6 Crosstalk Bug Fixed: sentence.end covers full overlapping speech duration', () => {
    // Word 1: Alice speaks "Wait" from 1.0 to 3.0 (e.g. drawn out speech)
    // Word 2: Bob interjects "no" from 1.2 to 1.6
    // Word 3: Bob interjects "stop." from 1.8 to 2.2
    // Inside a single sentence segment without speaker tags or grouped together:
    const crosstalkWords = [
      { word: 'Wait', start: 1.0, end: 3.0 },
      { word: 'no', start: 1.2, end: 1.6 },
      { word: 'stop.', start: 1.8, end: 2.2 },
    ];

    const sentences = segmentWordsIntoSentences(crosstalkWords);
    assert.strictEqual(sentences.length, 1);
    const s1 = sentences[0];

    // INVARIANT CHECK: sentence.end must cover all spoken words in the sentence!
    const maxWordEnd = Math.max(...s1.words.map((w) => w.end));
    assert.strictEqual(maxWordEnd, 3.0);
    assert.strictEqual(s1.end, 3.0, 'sentence.end is 3.0 covering Word 1');
    assert.strictEqual(s1.end, maxWordEnd);
  });

  await t.test('1.7 Malformed Transcripts: Inverted timestamps (end < start) rejected', () => {
    const invertedWords = [
      { word: 'Broken.', start: 5.0, end: 3.0 },
    ];
    const sentences = segmentWordsIntoSentences(invertedWords);
    assert.strictEqual(sentences.length, 0, 'Inverted words (end < start) must be filtered out');
  });
});

test('Challenger 2 Suite: Acoustic Silence Detection via Synthetic lavfi Audio', async (t) => {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  await t.test('2.1 Synthetic lavfi: Exact 500ms and 1000ms silence gaps verified within 10ms', async () => {
    const testFile = path.join(FIXTURES_DIR, 'synth_challenger_dual_gaps.wav');
    // Audio Structure:
    // [0.0s - 2.0s] 440Hz Sine Tone (2.0s)
    // [2.0s - 2.5s] Exact Silence Gap (0.500s) -> Gap 1: 2.000 to 2.500
    // [2.5s - 4.5s] 880Hz Sine Tone (2.0s)
    // [4.5s - 5.5s] Exact Silence Gap (1.000s) -> Gap 2: 4.500 to 5.500
    // [5.5s - 7.0s] 440Hz Sine Tone (1.5s)
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.0',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.5',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2.0',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.0',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
      '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]',
      '-map', '[out]', testFile,
    ]);

    const silences = await detectAcousticSilence(testFile, { minDuration: 0.3 });
    assert.strictEqual(silences.length, 2, 'Must detect exactly 2 silence intervals');

    // Gap 1: Ground truth [2.000, 2.500], duration 0.500
    const g1 = silences[0];
    const g1StartErr = Math.abs(g1.start - 2.000);
    const g1EndErr = Math.abs(g1.end - 2.500);
    assert.ok(g1StartErr <= 0.010, `Gap 1 start error ${g1StartErr * 1000}ms must be <= 10ms`);
    assert.ok(g1EndErr <= 0.010, `Gap 1 end error ${g1EndErr * 1000}ms must be <= 10ms`);
    assert.strictEqual(g1.duration, 0.5);

    // Gap 2: Ground truth [4.500, 5.500], duration 1.000
    const g2 = silences[1];
    const g2StartErr = Math.abs(g2.start - 4.500);
    const g2EndErr = Math.abs(g2.end - 5.500);
    assert.ok(g2StartErr <= 0.010, `Gap 2 start error ${g2StartErr * 1000}ms must be <= 10ms`);
    assert.ok(g2EndErr <= 0.010, `Gap 2 end error ${g2EndErr * 1000}ms must be <= 10ms`);
    assert.strictEqual(g2.duration, 1.0);
  });

  await t.test('2.2 Synthetic lavfi: Non-integer arbitrary float silence gaps (567ms & 825ms)', async () => {
    const testFile = path.join(FIXTURES_DIR, 'synth_challenger_float_gaps.wav');
    // [0.0s - 1.234s] Tone (1.234s)
    // [1.234s - 1.801s] Silence (0.567s)
    // [1.801s - 3.901s] Tone (2.100s)
    // [3.901s - 4.726s] Silence (0.825s)
    // [4.726s - 5.726s] Tone (1.000s)
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.234',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.567',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2.100',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.825',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.000',
      '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]',
      '-map', '[out]', testFile,
    ]);

    const silences = await detectAcousticSilence(testFile, { minDuration: 0.3 });
    assert.strictEqual(silences.length, 2);

    assert.ok(Math.abs(silences[0].start - 1.234) <= 0.010, 'Gap 1 start matches within 10ms');
    assert.ok(Math.abs(silences[0].end - 1.801) <= 0.010, 'Gap 1 end matches within 10ms');
    assert.ok(Math.abs(silences[1].start - 3.901) <= 0.010, 'Gap 2 start matches within 10ms');
    assert.ok(Math.abs(silences[1].end - 4.726) <= 0.010, 'Gap 2 end matches within 10ms');
  });

  await t.test('2.3 Synthetic lavfi: Strict 300ms boundary discrimination (301ms vs 299ms)', async () => {
    const filePass = path.join(FIXTURES_DIR, 'synth_challenger_301ms.wav');
    const fileFail = path.join(FIXTURES_DIR, 'synth_challenger_299ms.wav');

    // 301ms: above 300ms threshold -> detected
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.0',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.301',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.0',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', filePass,
    ]);
    const silPass = await detectAcousticSilence(filePass, { minDuration: 0.3 });
    assert.strictEqual(silPass.length, 1, '301ms pause must be detected');
    assert.ok(Math.abs(silPass[0].duration - 0.301) <= 0.010);

    // 299ms: below 300ms threshold -> strictly rejected
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.0',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.299',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.0',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', fileFail,
    ]);
    const silFail = await detectAcousticSilence(fileFail, { minDuration: 0.3 });
    assert.strictEqual(silFail.length, 0, '299ms pause must be ignored');
  });

  await t.test('2.4 Synthetic lavfi: Boundary conditions (leading silence, trailing silence, 100% silence)', async () => {
    // Leading silence 0.0 to 1.0s
    const fileLead = path.join(FIXTURES_DIR, 'synth_challenger_lead.wav');
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.0',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.5',
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
      '-map', '[out]', fileLead,
    ]);
    const silLead = await detectAcousticSilence(fileLead);
    assert.strictEqual(silLead.length, 1);
    assert.strictEqual(silLead[0].start, 0);
    assert.strictEqual(silLead[0].end, 1.0);

    // Trailing silence 1.5 to 2.5s
    const fileTrail = path.join(FIXTURES_DIR, 'synth_challenger_trail.wav');
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1.5',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.0',
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
      '-map', '[out]', fileTrail,
    ]);
    const silTrail = await detectAcousticSilence(fileTrail);
    assert.strictEqual(silTrail.length, 1);
    assert.strictEqual(silTrail[0].start, 1.5);
    assert.strictEqual(silTrail[0].end, 2.5);

    // 100% pure silence (4.0s)
    const fileAllSilence = path.join(FIXTURES_DIR, 'synth_challenger_pure_silence.wav');
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=4.0',
      fileAllSilence,
    ]);
    const silAll = await detectAcousticSilence(fileAllSilence);
    assert.strictEqual(silAll.length, 1);
    assert.strictEqual(silAll[0].start, 0);
    assert.strictEqual(silAll[0].end, 4.0);
    assert.strictEqual(silAll[0].duration, 4.0);
  });

  await t.test('2.5 Linguistic Silence Bug Fixed: No false silence reported during crosstalk active speech', () => {
    // Alice speaks continuously from 1.0 to 4.0
    // Bob makes short interjections: 1.5-2.0 and 2.5-3.0
    // Notice that between 2.0 and 2.5, Alice is still actively speaking!
    const words = [
      { word: 'AliceLongSpeech', start: 1.0, end: 4.0, speaker: 'Alice' },
      { word: 'BobFirst', start: 1.5, end: 2.0, speaker: 'Bob' },
      { word: 'BobSecond', start: 2.5, end: 3.0, speaker: 'Bob' },
    ];

    const silences = detectLinguisticSilence(words);
    const falseSilence = silences.find((s) => s.start === 2.0 && s.end === 2.5);
    assert.strictEqual(falseSilence, undefined, 'No false silence from 2.0 to 2.5 during active speech');

    // Trailing silence: last word ends at 3.0, but Alice spoke until 4.0
    const trailingSilences = detectLinguisticSilence(words, { totalDuration: 5.0 });
    const falseTrailing = trailingSilences.find((s) => s.start === 3.0);
    assert.strictEqual(falseTrailing, undefined, 'No false trailing silence from 3.0');
    assert.ok(trailingSilences.some((s) => s.start === 4.0 && s.end === 5.0), 'Trailing silence begins after latest word end (4.0 to 5.0)');
  });

  await t.test('2.6 Dual-Layer Merging: Hybrid merge cleanly joins acoustic and linguistic intervals', async () => {
    const acoustic = [
      { start: 2.0, end: 2.8, duration: 0.8, source: 'acoustic' },
    ];
    const linguistic = [
      { start: 2.05, end: 2.75, duration: 0.7, source: 'linguistic' },
    ];
    const merged = mergeSilenceIntervals(acoustic, linguistic);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].start, 2.0);
    assert.strictEqual(merged[0].end, 2.8);
    assert.strictEqual(merged[0].source, 'hybrid');
  });
});
