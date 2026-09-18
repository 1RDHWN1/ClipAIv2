// tests/integration/tier4_real_world.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { segmentWordsIntoSentences, buildSentenceMap } from '../../utils/sentenceSegmenter.js';
import { detectLinguisticSilence } from '../../utils/silenceDetector.js';
import { snapClipBoundaries, checkSpeechCollision } from '../../utils/boundarySnapper.js';
import {
  buildAudioCrossfadeFilter,
  resolveSentenceIds,
  buildStackedSplitFilterGraph,
  calculate916CropDimensions,
} from '../fixtures/testHarnessHelpers.js';
import {
  podcastDialogueWords,
  monologueLectureWords,
  noisyAudioWords,
} from '../fixtures/mockTranscripts.js';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * Tier 4: Real-World Scenarios
 * Tests complex, realistic multi-speaker, lecture, and noisy media conditions.
 */

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const DIALOGUE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_dialogue_1080p.mp4');
const STANDARD_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_standard_1080p.mp4');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('Tier 4: Real-World Scenarios', async (t) => {
  await t.test('Scenario 1: Multi-Speaker Podcast Dialogue (Alternating turns, Question Hook, Stacked Split-Screen)', async () => {
    // 1. Segmentation
    const sentences = segmentWordsIntoSentences(podcastDialogueWords);
    assert.ok(sentences.length >= 4, `Expected at least 4 sentences in podcast, got ${sentences.length}`);

    // Verify alternating speakers
    assert.strictEqual(sentences[0].speaker, 'Host');
    assert.strictEqual(sentences[1].speaker, 'Guest');

    // 2. Silence detection
    const silences = detectLinguisticSilence(podcastDialogueWords);
    assert.ok(silences.length >= 3, 'Should detect conversational gaps between turns');

    // 3. AI recommendation (Question hook)
    const map = buildSentenceMap(sentences);
    const clipRec = {
      startSentenceId: 's1',
      endSentenceId: 's2',
      title: 'Overcoming Bankruptcy',
      hookClassification: 'question',
      hookText: 'Have you ever lost everything?',
      narrativeRationale: {
        setup: 'Host asks about devastating loss.',
        climax: 'Guest reveals 2020 bankruptcy.',
        conclusion: 'They rebuilt and adapted.',
        isCompleteArc: true,
      },
      viralityScore: 94,
      viralityRationale: 'Compelling emotional hook with relatable adversity.',
    };

    // 4. Resolve sentence IDs and snap boundaries
    const resolved = resolveSentenceIds(clipRec, map, {
      sentences,
      words: podcastDialogueWords,
      silences,
    });

    // Verify active speech protection
    const startColl = checkSpeechCollision(resolved.start, podcastDialogueWords);
    assert.strictEqual(startColl.collides, false);
    const endColl = checkSpeechCollision(resolved.end, podcastDialogueWords);
    assert.strictEqual(endColl.collides, false);

    // 5. Stacked split-screen render
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(TEMP_OUTPUT_DIR, 'scenario1_podcast_output.mp4');

    const splitPlan = buildStackedSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      x1: 0.28,
      x2: 0.72,
    });
    const afFilter = buildAudioCrossfadeFilter(2.0, 0.030);

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-i', DIALOGUE_VIDEO_PATH,
      '-t', '2.0',
      '-filter_complex', `${splitPlan.filterComplex};[0:a]${afFilter}[a]`,
      '-map', splitPlan.outputMap,
      '-map', '[a]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Scenario 1 FFmpeg failed: ${code}`));
      });
    });

    assert.ok(fs.existsSync(outputPath));
    const meta = await probeMedia(outputPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert.ok(meta.duration >= 1.9);

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  await t.test('Scenario 2: Fast Monologue Lecture (Solo Speaker, High WPM, Bold Statement Hook)', async () => {
    // 1. Segmentation
    const sentences = segmentWordsIntoSentences(monologueLectureWords);
    assert.strictEqual(sentences.length, 2);
    assert.strictEqual(sentences[0].speaker, 'Lecturer');

    // 2. Silence detection
    const silences = detectLinguisticSilence(monologueLectureWords);
    assert.ok(silences.length >= 1, 'Should detect pause between the two rapid sentences');

    // 3. Narrative clip recommendation
    const map = buildSentenceMap(sentences);
    const clipRec = {
      startSentenceId: 's1',
      endSentenceId: 's2',
      title: 'AI Disruption Warning',
      hookClassification: 'bold_statement',
      hookText: 'Artificial intelligence is fundamentally transforming every single industry.',
      narrativeRationale: {
        setup: 'Bold claim on AI disruption.',
        climax: 'Warning about inaction and getting left behind.',
        conclusion: 'Call to action for industry professionals.',
        isCompleteArc: true,
      },
      viralityScore: 91,
      viralityRationale: 'Urgent authority hook with high relevance.',
    };

    const resolved = resolveSentenceIds(clipRec, map, {
      sentences,
      words: monologueLectureWords,
      silences,
    });

    // Verify speech protection
    const startColl = checkSpeechCollision(resolved.start, monologueLectureWords);
    assert.strictEqual(startColl.collides, false);
    const endColl = checkSpeechCollision(resolved.end, monologueLectureWords);
    assert.strictEqual(endColl.collides, false);

    // 4. Conformance single crop render
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(TEMP_OUTPUT_DIR, 'scenario2_lecture_output.mp4');

    const dims = calculate916CropDimensions(1920, 1080);
    const vf = `crop=${dims.cropWidth}:${dims.cropHeight}:${dims.defaultX}:${dims.defaultY},scale=1080:1920`;

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-i', STANDARD_VIDEO_PATH,
      '-t', '2.0',
      '-vf', vf,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Scenario 2 FFmpeg failed: ${code}`));
      });
    });

    assert.ok(fs.existsSync(outputPath));
    const meta = await probeMedia(outputPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert.ok(meta.duration >= 1.9);

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  await t.test('Scenario 3: Noisy Audio Environment (Low Confidence Tokens, Background Noise)', () => {
    // 1. Segmentation on low confidence words
    const sentences = segmentWordsIntoSentences(noisyAudioWords);
    assert.strictEqual(sentences.length, 2);

    // 2. Silence detection
    const silences = detectLinguisticSilence(noisyAudioWords);
    assert.ok(silences.length >= 1);

    // 3. Snapping ensures low-confidence words are still strictly protected from cutting
    const candidateClip = { start: 1.15, end: 4.80, title: 'Noisy Clip' };
    const snapped = snapClipBoundaries(candidateClip, {
      sentences,
      words: noisyAudioWords,
      silences,
    });

    for (const w of noisyAudioWords) {
      assert.strictEqual(
        snapped.start > w.start + 1e-4 && snapped.start < w.end - 1e-4,
        false,
        `Start at ${snapped.start} must not cut inside word "${w.word}"`
      );
      assert.strictEqual(
        snapped.end > w.start + 1e-4 && snapped.end < w.end - 1e-4,
        false,
        `End at ${snapped.end} must not cut inside word "${w.word}"`
      );
    }
  });
});
