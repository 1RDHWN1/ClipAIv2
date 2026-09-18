// tests/unit/audio_peak_detector.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import {
  parseEbur128Output,
  calculateLoudnessStats,
  clusterPeakIntervals,
  annotateSentencesWithAudioPeaks,
  detectAudioPeaks,
} from '../../utils/audioPeakDetector.js';

test('Audio Peak Detector (Milestone 3)', async (t) => {
  await t.test('Case 1: parseEbur128Output parses pts_time and lavfi.r128.M cleanly', () => {
    const rawOutput = `
frame:1 pts:4410 pts_time:0.1
lavfi.r128.M=-25.4
frame:2 pts:8820 pts_time:0.2
lavfi.r128.M=-14.2
frame:3 pts:13230 pts_time:0.3
lavfi.r128.M=-12.8
frame:4 pts:17640 pts_time:0.4
lavfi.r128.M=-28.0
`;
    const samples = parseEbur128Output(rawOutput);
    assert.strictEqual(samples.length, 4, 'Should parse exactly 4 samples');
    assert.deepStrictEqual(samples[1], { time: 0.2, lufs: -14.2 });
    assert.deepStrictEqual(samples[2], { time: 0.3, lufs: -12.8 });
  });

  await t.test('Case 2: calculateLoudnessStats calculates correct mean, max, and threshold', () => {
    const samples = [
      { time: 0.1, lufs: -24.0 },
      { time: 0.2, lufs: -22.0 },
      { time: 0.3, lufs: -10.0 }, // Peak
      { time: 0.4, lufs: -26.0 },
    ];
    const stats = calculateLoudnessStats(samples);
    assert.ok(stats.mean < -15, 'Mean should reflect normal speech level');
    assert.strictEqual(stats.max, -10.0, 'Max should be -10.0 LUFS');
    assert.ok(stats.threshold <= -12.0 && stats.threshold >= -18.0, 'Threshold should be clamped properly');
  });

  await t.test('Case 3: clusterPeakIntervals merges closely spaced peaks above threshold', () => {
    const samples = [
      { time: 1.0, lufs: -13.0 },
      { time: 1.2, lufs: -11.0 },
      { time: 1.4, lufs: -12.5 },
      { time: 2.0, lufs: -25.0 }, // Drop
      { time: 2.5, lufs: -12.0 }, // Peak close to previous (within 1.5s gap)
      { time: 2.7, lufs: -13.0 },
      { time: 3.5, lufs: -28.0 },
    ];
    const threshold = -15.0;
    const peaks = clusterPeakIntervals(samples, threshold, { minPeakDuration: 0.2, mergeGapSec: 1.5 });

    assert.ok(peaks.length >= 1, 'Should cluster peaks into interval');
    assert.strictEqual(peaks[0].peakLufs, -11.0);
    assert.ok(peaks[0].intensityScore >= 50, 'Intensity score should be normalized high');
  });

  await t.test('Case 4: annotateSentencesWithAudioPeaks flags sentences overlapping peaks', () => {
    const sentences = [
      { id: 's1', start: 0.0, end: 3.0, text: 'Halo selamat datang di stream' },
      { id: 's2', start: 3.5, end: 6.0, text: 'WADUH KENA HEADSHOT GOOOL!' },
      { id: 's3', start: 6.5, end: 9.0, text: 'Santai dulu kita regroup' },
    ];

    const peaks = [
      { start: 4.0, end: 5.5, peakLufs: -9.5, intensityScore: 92 },
    ];

    const annotated = annotateSentencesWithAudioPeaks(sentences, peaks);
    assert.strictEqual(annotated[0].isHypePeak, false);
    assert.strictEqual(annotated[1].isHypePeak, true);
    assert.strictEqual(annotated[1].hypeScore, 92);
    assert.strictEqual(annotated[2].isHypePeak, false);
  });

  await t.test('Case 5: detectAudioPeaks executes real FFmpeg on sample audio file', async () => {
    const audioPath = path.resolve('tests/fixtures/media/sample_silence_audio.wav');
    assert.ok(fs.existsSync(audioPath), 'Fixture must exist');

    const result = await detectAudioPeaks(audioPath);
    assert.ok(result.stats, 'Result must contain stats');
    assert.ok(Array.isArray(result.peaks), 'Peaks must be an array');
    assert.ok(Array.isArray(result.samples), 'Samples must be an array');
    assert.ok(result.samples.length > 0, 'Should have processed audio samples');
  });
});
