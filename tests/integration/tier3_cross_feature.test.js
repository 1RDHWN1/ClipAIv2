// tests/integration/tier3_cross_feature.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { segmentWordsIntoSentences, buildSentenceMap } from '../../utils/sentenceSegmenter.js';
import { detectSilence, detectLinguisticSilence } from '../../utils/silenceDetector.js';
import { snapBoundary, snapClipBoundaries, checkSpeechCollision } from '../../utils/boundarySnapper.js';
import {
  buildAudioCrossfadeFilter,
  resolveSentenceIds,
  buildFFmpegEasingCropX,
  createCameraTrajectory,
  sampleTrajectory,
  buildStackedSplitFilterGraph,
  calculate916CropDimensions,
} from '../fixtures/testHarnessHelpers.js';
import { standardWords } from '../fixtures/mockTranscripts.js';
import { mockQuestionClip } from '../fixtures/mockNarratives.js';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * Tier 3: Cross-Feature Interactions
 * Tests pairwise combinations and cross-module contracts.
 */

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const DIALOGUE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_dialogue_1080p.mp4');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('Tier 3: Cross-Feature Interactions', async (t) => {
  await t.test('Interaction 1 (F1+F2+F3+F4+F5): Words -> Sentences -> Silences -> Boundary Snapping with Speech Protection', () => {
    // 1. Segment words into sentences
    const sentences = segmentWordsIntoSentences(standardWords);
    assert.strictEqual(sentences.length, 3);

    // 2. Detect silences
    const silences = detectLinguisticSilence(standardWords);
    assert.ok(silences.length >= 2);

    // 3. Propose raw clip start (inside word "Welcome" at 1.2s) and end (inside word "guest" at 4.6s)
    const rawClip = { start: 1.20, end: 4.60, title: 'Cross Feature Clip' };

    // 4. Snap boundaries
    const snapped = snapClipBoundaries(rawClip, { sentences, words: standardWords, silences });

    // 5. Assert hard invariant: neither start nor end cuts off inside active words
    const startColl = checkSpeechCollision(snapped.start, standardWords);
    assert.strictEqual(startColl.collides, false, 'Snapped start must not collide with active speech');

    const endColl = checkSpeechCollision(snapped.end, standardWords);
    assert.strictEqual(endColl.collides, false, 'Snapped end must not collide with active speech');

    // 6. Assert snapped to within 100ms of sentence boundary or inside silence
    assert.ok(Math.abs(snapped.start - 1.00) <= 0.1);
    assert.ok(Math.abs(snapped.end - 4.70) <= 0.1);
  });

  await t.test('Interaction 2 (F2+F7+F8+F9+F10+F11): Sentences -> Narrative IDs -> Resolution -> Snapping', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    const map = buildSentenceMap(sentences);
    const silences = detectLinguisticSilence(standardWords);

    // Resolved clip from AI recommendation referencing discrete IDs 's1' and 's2'
    const clipRecommendation = {
      startSentenceId: 's1',
      endSentenceId: 's2',
      title: 'Hook Clip',
      hookClassification: 'question',
      hookText: 'Welcome to our podcast.',
      narrativeRationale: {
        setup: 'Introduction',
        climax: 'Guest arrival',
        conclusion: 'Conversation starts',
        isCompleteArc: true,
      },
      viralityScore: 90,
      viralityRationale: 'Strong hook',
    };

    const resolved = resolveSentenceIds(clipRecommendation, map, {
      sentences,
      words: standardWords,
      silences,
    });

    assert.ok(typeof resolved.start === 'number');
    assert.ok(typeof resolved.end === 'number');
    assert.ok(resolved.end > resolved.start);
    assert.strictEqual(resolved.resolvedSentences.count, 2);
    assert.strictEqual(resolved.hookClassification, 'question');
    assert.strictEqual(resolved.viralityScore, 90);
  });

  await t.test('Interaction 3 (F3+F4+F6): Silence Detection + Boundary Snapping + 30ms Audio Crossfade', () => {
    const sentences = segmentWordsIntoSentences(standardWords);
    const silences = detectLinguisticSilence(standardWords);

    // Snap clip boundaries
    const snapped = snapClipBoundaries({ start: 1.05, end: 4.65 }, { sentences, words: standardWords, silences });
    const clipDuration = snapped.end - snapped.start;
    assert.ok(clipDuration > 0);

    // Build crossfade filter for snapped duration
    const afFilter = buildAudioCrossfadeFilter(clipDuration, 0.030);
    assert.ok(afFilter.includes('afade=t=in:st=0:d=0.030'));
    assert.ok(afFilter.includes('afade=t=out:st='));
  });

  await t.test('Interaction 4 (F12+F13+F15): Face Tracking Anchors + Smooth Camera Easing + 9:16 Render', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(TEMP_OUTPUT_DIR, 'test_easing_render.mp4');

    // 1920x1080 source: Speaker 1 at x=400, Speaker 2 at x=800
    // Camera smoothly glides from 400 to 800 over 0.5s (between 1.0s and 1.5s)
    const cropDims = calculate916CropDimensions(1920, 1080);
    const xExpr = buildFFmpegEasingCropX(400, 800, 1.0, 1.5);
    const vf = `crop=${cropDims.cropWidth}:${cropDims.cropHeight}:${xExpr}:${cropDims.defaultY},scale=1080:1920`;

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-i', DIALOGUE_VIDEO_PATH,
      '-t', '2.0',
      '-vf', vf,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-an',
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg easing render failed with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(outputPath));
    const meta = await probeMedia(outputPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert.ok(meta.duration >= 1.9);

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  await t.test('Interaction 5 (F14+F6+F15): Stacked Split-Screen + Audio Crossfade + 1080x1920 Video Output', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(TEMP_OUTPUT_DIR, 'test_split_crossfade.mp4');

    const splitPlan = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 0.28, x2: 0.72 });
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
        else reject(new Error(`FFmpeg split+crossfade render failed with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(outputPath));
    const meta = await probeMedia(outputPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert.ok(meta.duration >= 1.9);
    assert.ok(meta.audioStream);

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });
});
