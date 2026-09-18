// tests/unit/f15_conformance.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { probeMedia } from '../fixtures/syntheticMedia.js';

/**
 * Feature F15: Production 9:16 Conformance
 * Requirements: ORIGINAL_REQUEST §R3, AC Visual Cropping & Reframing, PROJECT.md F15
 *
 * Invariant:
 *  - Enforces strictly even dimensions for crop width, height, and offsets.
 *  - Output video stream produces valid 9:16 (1080x1920) render outputs.
 *  - Eliminates 1-pixel letterboxing/pillarboxing black slivers.
 *  - Complies with H.264 / YUV420p chroma subsampling standards.
 */

/**
 * Computes conformant, strictly even 9:16 crop dimensions from any source resolution.
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @returns {{ cropWidth: number, cropHeight: number, defaultX: number, defaultY: number, renderWidth: number, renderHeight: number }}
 */
export function calculate916CropDimensions(srcWidth, srcHeight) {
  if (typeof srcWidth !== 'number' || typeof srcHeight !== 'number' || srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`Invalid source dimensions: ${srcWidth}x${srcHeight}`);
  }

  // Calculate target width for 9:16 aspect ratio, ensuring it's an even integer
  let targetWidth = Math.floor((srcHeight * 9 / 16) / 2) * 2;
  if (targetWidth > srcWidth) {
    targetWidth = Math.floor(srcWidth / 2) * 2;
  }

  // Calculate crop height, ensuring it matches 16/9 and is an even integer <= srcHeight
  let targetHeight = Math.floor((targetWidth * 16 / 9) / 2) * 2;
  if (targetHeight > srcHeight) {
    targetHeight = Math.floor(srcHeight / 2) * 2;
    targetWidth = Math.floor((targetHeight * 9 / 16) / 2) * 2;
  }

  // Centered offsets, strictly even integers
  const defaultX = Math.floor((srcWidth - targetWidth) / 4) * 2;
  const defaultY = Math.floor((srcHeight - targetHeight) / 4) * 2;

  return {
    cropWidth: targetWidth,
    cropHeight: targetHeight,
    defaultX,
    defaultY,
    renderWidth: 1080,
    renderHeight: 1920,
  };
}

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const STANDARD_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample_standard_1080p.mp4');
const TEMP_OUTPUT_DIR = path.resolve('tests/fixtures/temp');

test('Tier 1: F15 - Production 9:16 Conformance', async (t) => {
  await t.test('Case 1: Standard 1080p source (1920x1080) yields strictly even crop dimensions', () => {
    const dims = calculate916CropDimensions(1920, 1080);
    assert.strictEqual(dims.cropWidth % 2, 0, 'cropWidth must be even');
    assert.strictEqual(dims.cropHeight % 2, 0, 'cropHeight must be even');
    assert.strictEqual(dims.defaultX % 2, 0, 'defaultX must be even');
    assert.strictEqual(dims.defaultY % 2, 0, 'defaultY must be even');
    // Ensure it avoids the 607x1079 odd dimension bug
    assert.notStrictEqual(dims.cropWidth, 607);
    assert.notStrictEqual(dims.cropHeight, 1079);
  });

  await t.test('Case 2: Exact 9:16 ratio maintained within 0.005 tolerance', () => {
    const dims = calculate916CropDimensions(1920, 1080);
    const ratio = dims.cropWidth / dims.cropHeight;
    const targetRatio = 9 / 16; // 0.5625
    assert.ok(Math.abs(ratio - targetRatio) < 0.005, `Ratio ${ratio} must closely match 9/16 (0.5625)`);
  });

  await t.test('Case 3: Target render resolution is fixed at 1080x1920', () => {
    const dims = calculate916CropDimensions(1920, 1080);
    assert.strictEqual(dims.renderWidth, 1080);
    assert.strictEqual(dims.renderHeight, 1920);
  });

  await t.test('Case 4: 4K source (3840x2160) yields even crop dimensions', () => {
    const dims = calculate916CropDimensions(3840, 2160);
    assert.strictEqual(dims.cropWidth % 2, 0);
    assert.strictEqual(dims.cropHeight % 2, 0);
    assert.strictEqual(dims.defaultX % 2, 0);
    assert.strictEqual(dims.defaultY % 2, 0);
  });

  await t.test('Case 5: FFmpeg renders production-grade 1080x1920 MP4 from standard fixture', async () => {
    if (!fs.existsSync(TEMP_OUTPUT_DIR)) fs.mkdirSync(TEMP_OUTPUT_DIR, { recursive: true });
    const renderedPath = path.join(TEMP_OUTPUT_DIR, 'test_conform_output.mp4');

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
      renderedPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(renderedPath));
    const meta = await probeMedia(renderedPath);
    assert.strictEqual(meta.width, 1080, 'Rendered width must be 1080');
    assert.strictEqual(meta.height, 1920, 'Rendered height must be 1920');
    assert.ok(meta.duration > 0, 'Rendered duration must be > 0');
    assert.strictEqual(meta.videoStream.pix_fmt, 'yuv420p');

    // Cleanup
    if (fs.existsSync(renderedPath)) fs.unlinkSync(renderedPath);
  });
});

test('Tier 2: F15 - Conformance Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: 720p source (1280x720) calculates even dimensions', () => {
    const dims = calculate916CropDimensions(1280, 720);
    assert.strictEqual(dims.cropWidth % 2, 0);
    assert.strictEqual(dims.cropHeight % 2, 0);
    assert.strictEqual(dims.defaultX % 2, 0);
  });

  await t.test('Case 2: 4:3 source (1440x1080) crops cleanly without distortion', () => {
    const dims = calculate916CropDimensions(1440, 1080);
    assert.strictEqual(dims.cropWidth % 2, 0);
    assert.strictEqual(dims.cropHeight % 2, 0);
    assert.ok(dims.cropWidth <= 1440);
  });

  await t.test('Case 3: Odd dimension source (1921x1079) rounded to even crop coordinates', () => {
    const dims = calculate916CropDimensions(1921, 1079);
    assert.strictEqual(dims.cropWidth % 2, 0);
    assert.strictEqual(dims.cropHeight % 2, 0);
    assert.strictEqual(dims.defaultX % 2, 0);
    assert.strictEqual(dims.defaultY % 2, 0);
  });

  await t.test('Case 4: Vertical source already 9:16 (1080x1920) preserved without unnecessary cropping', () => {
    const dims = calculate916CropDimensions(1080, 1920);
    assert.strictEqual(dims.cropWidth, 1080);
    assert.strictEqual(dims.cropHeight, 1920);
    assert.strictEqual(dims.defaultX, 0);
    assert.strictEqual(dims.defaultY, 0);
  });

  await t.test('Case 5: Zero or negative source dimensions throw error', () => {
    assert.throws(() => calculate916CropDimensions(0, 1080), /Invalid source dimensions/);
    assert.throws(() => calculate916CropDimensions(1920, -500), /Invalid source dimensions/);
  });
});
