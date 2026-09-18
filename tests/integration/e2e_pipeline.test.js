// tests/integration/e2e_pipeline.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { segmentWordsIntoSentences, buildSentenceMap } from '../../utils/sentenceSegmenter.js';
import { detectSilence, detectLinguisticSilence } from '../../utils/silenceDetector.js';
import { snapClipBoundaries, checkSpeechCollision } from '../../utils/boundarySnapper.js';
import {
  buildAudioCrossfadeFilter,
  resolveSentenceIds,
  buildStackedSplitFilterGraph,
  calculate916CropDimensions,
  verifyBoundaryPrecision,
  verifyVideoConformance,
} from '../fixtures/testHarnessHelpers.js';
import { podcastDialogueWords, standardWords } from '../fixtures/mockTranscripts.js';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * End-to-End Pipeline Integration Test
 * Validates the complete pipeline flow with synthetic media, asserting:
 *  - Timestamps strictly align with sentence boundaries / silences
 *  - No audio cuts occur during active speech tokens
 *  - Output video files adhere to valid 9:16 (1080x1920) aspect ratios with non-zero durations
 *  - Zero unhandled promise rejections or worker crashes
 */

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const DIALOGUE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_dialogue_1080p.mp4');
const STANDARD_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_standard_1080p.mp4');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('E2E Full Pipeline Integration', async (t) => {
  await t.test('Full E2E Pipeline Run: Dialogue Input -> Segment -> Silence -> Resolve -> Snap -> Stacked Render -> Conformance Probe', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const e2eOutputPath = path.join(TEMP_OUTPUT_DIR, 'e2e_dialogue_clip.mp4');

    // Step 1: Segmentation
    const sentences = segmentWordsIntoSentences(podcastDialogueWords);
    assert.ok(sentences.length >= 2, 'Sentences segmented');
    const sentenceMap = buildSentenceMap(sentences);

    // Step 2: Silence detection
    const silences = detectLinguisticSilence(podcastDialogueWords);
    assert.ok(silences.length > 0, 'Silences detected');

    // Step 3: AI clip recommendation with discrete sentence IDs
    const aiRecommendation = {
      startSentenceId: 's1',
      endSentenceId: 's2',
      title: 'E2E Podcast Highlight',
      hookClassification: 'question',
      hookText: 'Have you ever lost everything?',
      narrativeRationale: {
        setup: 'Host questions devastating failure.',
        climax: 'Guest reveals 2020 bankruptcy.',
        conclusion: 'Pivoting to AI and recovery.',
        isCompleteArc: true,
      },
      viralityScore: 92,
      viralityRationale: 'High engagement potential',
    };

    // Step 4: Resolve IDs and snap boundaries
    const resolvedClip = resolveSentenceIds(aiRecommendation, sentenceMap, {
      sentences,
      words: podcastDialogueWords,
      silences,
    });

    // Step 5: Verification of boundary snapping and active speech protection
    const boundaryCheck = verifyBoundaryPrecision([resolvedClip], sentences, silences, podcastDialogueWords);
    assert.strictEqual(boundaryCheck.passed, true, `Boundary check failed: ${boundaryCheck.failures.join(', ')}`);

    // Step 6: Render execution with stacked split-screen layout and audio crossfade
    const clipDuration = resolvedClip.end - resolvedClip.start;
    assert.ok(clipDuration > 0, `Clip duration must be > 0 (got ${clipDuration}s)`);

    const splitPlan = buildStackedSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      x1: 0.28,
      x2: 0.72,
    });

    // Render 2.0s slice of the clip
    const renderDuration = Math.min(2.0, clipDuration);
    const afFilter = buildAudioCrossfadeFilter(renderDuration, 0.030);

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-ss', String(resolvedClip.start),
      '-i', DIALOGUE_VIDEO_PATH,
      '-t', String(renderDuration),
      '-filter_complex', `${splitPlan.filterComplex};[0:a]${afFilter}[a]`,
      '-map', splitPlan.outputMap,
      '-map', '[a]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      e2eOutputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`E2E Pipeline FFmpeg failed with exit code ${code}`));
      });
    });

    // Step 7: Probe output and verify all acceptance criteria
    assert.ok(fs.existsSync(e2eOutputPath), 'Rendered output file must exist');
    const fileSize = fs.statSync(e2eOutputPath).size;
    assert.ok(fileSize > 0, 'Rendered file size must be > 0 bytes');

    const probe = await probeMedia(e2eOutputPath);
    const conformance = verifyVideoConformance(probe);
    assert.strictEqual(conformance.passed, true, `Video conformance failed: ${conformance.errors.join(', ')}`);
    assert.strictEqual(probe.width, 1080);
    assert.strictEqual(probe.height, 1920);
    assert.ok(probe.duration > 0);
    assert.ok(probe.audioStream, 'Audio stream must be present in output');

    // Cleanup
    if (fs.existsSync(e2eOutputPath)) fs.unlinkSync(e2eOutputPath);
  });

  await t.test('Full E2E Pipeline Run: Monologue Input -> Single Crop Render -> Output Conformance', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const e2eOutputPath = path.join(TEMP_OUTPUT_DIR, 'e2e_monologue_clip.mp4');

    const sentences = segmentWordsIntoSentences(standardWords);
    const sentenceMap = buildSentenceMap(sentences);
    const silences = detectLinguisticSilence(standardWords);

    const aiRecommendation = {
      startSentenceId: 's1',
      endSentenceId: 's3',
      title: 'Solo Monologue Highlight',
      hookClassification: 'bold_statement',
      hookText: 'Welcome to our podcast.',
      narrativeRationale: {
        setup: 'Intro',
        climax: 'Guest introduction',
        conclusion: 'Story kickoff',
        isCompleteArc: true,
      },
      viralityScore: 88,
      viralityRationale: 'Solid hook',
    };

    const resolvedClip = resolveSentenceIds(aiRecommendation, sentenceMap, {
      sentences,
      words: standardWords,
      silences,
    });

    const boundaryCheck = verifyBoundaryPrecision([resolvedClip], sentences, silences, standardWords);
    assert.strictEqual(boundaryCheck.passed, true);

    const dims = calculate916CropDimensions(1920, 1080);
    const vf = `crop=${dims.cropWidth}:${dims.cropHeight}:${dims.defaultX}:${dims.defaultY},scale=1080:1920`;
    const afFilter = buildAudioCrossfadeFilter(2.0, 0.030);

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-ss', String(resolvedClip.start),
      '-i', STANDARD_VIDEO_PATH,
      '-t', '2.0',
      '-vf', vf,
      '-af', afFilter,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      e2eOutputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`E2E Monologue FFmpeg failed: ${code}`));
      });
    });

    assert.ok(fs.existsSync(e2eOutputPath));
    const probe = await probeMedia(e2eOutputPath);
    const conformance = verifyVideoConformance(probe);
    assert.strictEqual(conformance.passed, true);
    assert.strictEqual(probe.width, 1080);
    assert.strictEqual(probe.height, 1920);
    assert.ok(probe.duration > 0);

    // Cleanup
    if (fs.existsSync(e2eOutputPath)) fs.unlinkSync(e2eOutputPath);
  });
});
