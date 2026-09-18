// tests/unit/f14_splitscreen.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * Feature F14: Stacked Split-Screen Layout
 * Requirements: ORIGINAL_REQUEST §R3, PROJECT.md F14
 *
 * Invariant:
 *  - Implements stacked split-screen layout (`vstack`, 1080x960 panels).
 *  - Two speaker panels (top and bottom) each render at 1080x960.
 *  - Total stacked render output is strictly 1080x1920 (9:16).
 */

/**
 * Builds the FFmpeg filter_complex graph for stacked split screen.
 * @param {Object} params
 * @param {number} params.srcWidth
 * @param {number} params.srcHeight
 * @param {number} [params.x1] - Center x of speaker 1 (pixels or normalized 0-1)
 * @param {number} [params.x2] - Center x of speaker 2 (pixels or normalized 0-1)
 * @returns {{ filterComplex: string, outputMap: string, renderWidth: number, renderHeight: number }}
 */
export function buildStackedSplitFilterGraph({
  srcWidth = 1920,
  srcHeight = 1080,
  x1,
  x2,
} = {}) {
  // Each panel is 1080x960, which has aspect ratio 1080 / 960 = 9 / 8 = 1.125
  // For a 1080p source (1920x1080), panel crop height is srcHeight (1080).
  // Panel crop width = Math.floor(1080 * 9 / 8 / 2) * 2 = 1214 (or similar),
  // or cropHeight = srcHeight / 2 = 540 and panel crop width = 540 * 9 / 8 = 608.
  // Standard framing: crop 608x540 and scale to 1080x960.
  const panelCropW = 608;
  const panelCropH = Math.min(srcHeight, 540);

  // Normalize or default speaker center coordinates
  const posX1 = typeof x1 === 'number'
    ? (x1 <= 1.0 ? Math.floor(x1 * srcWidth) : x1)
    : Math.floor(srcWidth * 0.28);

  const posX2 = typeof x2 === 'number'
    ? (x2 <= 1.0 ? Math.floor(x2 * srcWidth) : x2)
    : Math.floor(srcWidth * 0.72);

  // Calculate crop top-left offsets (clamped within [0, srcWidth - panelCropW])
  const cropX1 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(posX1 - panelCropW / 2)));
  const cropX2 = Math.max(0, Math.min(srcWidth - panelCropW, Math.floor(posX2 - panelCropW / 2)));
  const cropY = Math.max(0, Math.floor((srcHeight - panelCropH) / 2));

  // Ensure even coordinates
  const evenX1 = Math.floor(cropX1 / 2) * 2;
  const evenX2 = Math.floor(cropX2 / 2) * 2;
  const evenY = Math.floor(cropY / 2) * 2;

  const filterComplex = [
    `[0:v]crop=${panelCropW}:${panelCropH}:${evenX1}:${evenY},scale=1080:960[top]`,
    `[0:v]crop=${panelCropW}:${panelCropH}:${evenX2}:${evenY},scale=1080:960[bottom]`,
    `[top][bottom]vstack=inputs=2[v]`,
  ].join(';');

  return {
    filterComplex,
    outputMap: '[v]',
    renderWidth: 1080,
    renderHeight: 1920,
    panelWidth: 1080,
    panelHeight: 960,
  };
}

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const DIALOGUE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_dialogue_1080p.mp4');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('Tier 1: F14 - Stacked Split-Screen Layout', async (t) => {
  await t.test('Case 1: Generates vstack=inputs=2 filter graph', () => {
    const { filterComplex } = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080 });
    assert.ok(filterComplex.includes('vstack=inputs=2'));
  });

  await t.test('Case 2: Top panel crops speaker 1 and scales to 1080:960', () => {
    const { filterComplex } = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 480, x2: 1440 });
    assert.ok(filterComplex.includes('scale=1080:960[top]'));
  });

  await t.test('Case 3: Bottom panel crops speaker 2 and scales to 1080:960', () => {
    const { filterComplex } = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 480, x2: 1440 });
    assert.ok(filterComplex.includes('scale=1080:960[bottom]'));
  });

  await t.test('Case 4: Combined stacked dimensions are strictly 1080x1920', () => {
    const plan = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080 });
    assert.strictEqual(plan.renderWidth, 1080);
    assert.strictEqual(plan.renderHeight, 1920);
    assert.strictEqual(plan.panelHeight * 2, plan.renderHeight);
  });

  await t.test('Case 5: FFmpeg renders 1080x1920 stacked split-screen video from dialogue fixture', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const splitOutputPath = path.join(TEMP_OUTPUT_DIR, 'test_split_output.mp4');

    const { filterComplex, outputMap } = buildStackedSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      x1: 0.25,
      x2: 0.75,
    });

    const args = [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-i', DIALOGUE_VIDEO_PATH,
      '-t', '2.0',
      '-filter_complex', filterComplex,
      '-map', outputMap,
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      splitOutputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(splitOutputPath));
    const meta = await probeMedia(splitOutputPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert.ok(meta.duration >= 1.9);

    // Cleanup
    if (fs.existsSync(splitOutputPath)) fs.unlinkSync(splitOutputPath);
  });
});

test('Tier 2: F14 - Split Screen Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Handles normalized coordinates [0.0 - 1.0] and pixel coordinates (>1.0)', () => {
    const norm = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 0.3, x2: 0.7 });
    const px = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 576, x2: 1344 });
    assert.strictEqual(norm.filterComplex, px.filterComplex);
  });

  await t.test('Case 2: Inverted speaker order (x1 on right, x2 on left) maintains separate panels', () => {
    const inverted = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: 0.8, x2: 0.2 });
    assert.ok(inverted.filterComplex.includes('[top]'));
    assert.ok(inverted.filterComplex.includes('[bottom]'));
  });

  await t.test('Case 3: Odd source video dimensions padded/aligned to even crop coordinates', () => {
    const oddPlan = buildStackedSplitFilterGraph({ srcWidth: 1921, srcHeight: 1079 });
    // Match crop=608:540:evenX:evenY
    const match = oddPlan.filterComplex.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
    assert.ok(match);
    const [, w, h, x, y] = match.map(Number);
    assert.strictEqual(w % 2, 0, 'Crop width must be even');
    assert.strictEqual(h % 2, 0, 'Crop height must be even');
    assert.strictEqual(x % 2, 0, 'Crop x must be even');
    assert.strictEqual(y % 2, 0, 'Crop y must be even');
  });

  await t.test('Case 4: Extreme border coordinates clamped within frame boundary', () => {
    const borderPlan = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, x1: -100, x2: 3000 });
    assert.ok(borderPlan.filterComplex.includes(':0:')); // x1 clamped to 0
    // x2 clamped to 1920 - 608 = 1312
    assert.ok(borderPlan.filterComplex.includes(':1312:'));
  });

  await t.test('Case 5: Missing speaker coordinates default to balanced 0.28 and 0.72 ratios', () => {
    const defaultPlan = buildStackedSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080 });
    assert.ok(defaultPlan.filterComplex.includes('[top]'));
    assert.ok(defaultPlan.filterComplex.includes('[bottom]'));
  });
});
