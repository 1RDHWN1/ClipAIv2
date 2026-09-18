// tests/unit/f6_crossfade.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * Feature F6: Audio Seam Crossfading
 * Requirement: ORIGINAL_REQUEST §R1, PROJECT.md F6
 *
 * Invariant:
 * Applies 30ms audio seam fades at clip boundaries to eliminate pop/click artifacts.
 * Filter graph: afade=t=in:st=0:d=0.030,afade=t=out:st=${duration - 0.030}:d=0.030
 */

import {
  buildAudioCrossfadeFilter,
  DEFAULT_FADE_DURATION,
} from '../../utils/boundarySnapper.js';

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const SILENCE_AUDIO_PATH = path.join(FIXTURES_DIR, 'sample_silence_audio.wav');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('Tier 1: F6 - Audio Seam Crossfading', async (t) => {
  await t.test('Case 1: Builds 30ms fade-in filter at st=0', () => {
    const filter = buildAudioCrossfadeFilter(10.0, 0.030);
    assert.ok(filter.includes('afade=t=in:st=0:d=0.030'));
  });

  await t.test('Case 2: Builds 30ms fade-out filter ending at duration', () => {
    const filter = buildAudioCrossfadeFilter(10.0, 0.030);
    // For 10.0s clip, fade-out starts at 9.970s
    assert.ok(filter.includes('afade=t=out:st=9.970:d=0.030'));
  });

  await t.test('Case 3: Combines fade-in and fade-out into comma-separated filter chain', () => {
    const filter = buildAudioCrossfadeFilter(5.0);
    assert.strictEqual(filter, 'afade=t=in:st=0:d=0.030,afade=t=out:st=4.970:d=0.030');
  });

  await t.test('Case 4: Calculates correct fade-out start for arbitrary clip durations', () => {
    const f30s = buildAudioCrossfadeFilter(30.0);
    assert.ok(f30s.includes('st=29.970'));

    const f60s = buildAudioCrossfadeFilter(60.0);
    assert.ok(f60s.includes('st=59.970'));
  });

  await t.test('Case 5: FFmpeg executes audio crossfade filter cleanly on media fixture', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const fadedAudioPath = path.join(TEMP_OUTPUT_DIR, 'faded_test.wav');

    const filter = buildAudioCrossfadeFilter(3.0, 0.030);
    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-i', SILENCE_AUDIO_PATH,
      '-t', '3.0',
      '-af', filter,
      fadedAudioPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(fadedAudioPath));
    const meta = await probeMedia(fadedAudioPath);
    assert.ok(meta.duration >= 2.9 && meta.duration <= 3.1);

    // Cleanup
    if (fs.existsSync(fadedAudioPath)) fs.unlinkSync(fadedAudioPath);
  });
});

test('Tier 2: F6 - Crossfade Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Ultra-short clip (<60ms) clamps fade duration to duration/2', () => {
    // 40ms clip -> 20ms fade in, 20ms fade out
    const filter = buildAudioCrossfadeFilter(0.040, 0.030);
    assert.strictEqual(filter, 'afade=t=in:st=0:d=0.020,afade=t=out:st=0.020:d=0.020');
  });

  await t.test('Case 2: Exact 60ms clip duration meets precisely at midpoint', () => {
    const filter = buildAudioCrossfadeFilter(0.060, 0.030);
    assert.strictEqual(filter, 'afade=t=in:st=0:d=0.030,afade=t=out:st=0.030:d=0.030');
  });

  await t.test('Case 3: Zero or negative duration throws descriptive error', () => {
    assert.throws(() => buildAudioCrossfadeFilter(0), /Invalid duration/);
    assert.throws(() => buildAudioCrossfadeFilter(-5), /Invalid duration/);
  });

  await t.test('Case 4: Long clip (>1 hour = 3600s) correctly offsets fade-out', () => {
    const filter = buildAudioCrossfadeFilter(3600.0);
    assert.ok(filter.includes('st=3599.970'));
  });

  await t.test('Case 5: Non-numeric duration input throws descriptive error', () => {
    assert.throws(() => buildAudioCrossfadeFilter('invalid'), /Invalid duration/);
    assert.throws(() => buildAudioCrossfadeFilter(NaN), /Invalid duration/);
  });
});
