import test from 'node:test';
import assert from 'node:assert';
import { buildGamingStreamerFilterGraph } from '../../utils/clipper.js';

test('Gaming Streamer Webcam Detection & Positioning', async (t) => {
  await t.test('Case 1: explicit webcam coordinates are correctly injected into crop filter', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: 832,
      camY: 396,
      camW: 448,
      camH: 324,
    });

    assert.strictEqual(graph.renderWidth, 1080);
    assert.strictEqual(graph.renderHeight, 1920);
    // Panel atas harus memotong webcam di koordinat (832, 396) dengan ukuran 448x324
    assert.ok(
      graph.filterComplex.includes('crop=448:324:832:396'),
      `Filter complex must crop webcam at (832, 396), got: ${graph.filterComplex}`
    );
    assert.ok(graph.filterComplex.includes('scale=1080:800'), 'Cam must be scaled to 1080x800');
    assert.ok(graph.filterComplex.includes('scale=1080:1120'), 'Game must be fitted to 1080x1120');
    assert.ok(graph.filterComplex.includes('vstack=inputs=2'), 'Must stack vertically');
  });

  await t.test('Case 2: default fallback coordinates clamp safely to bottom-right corner', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: undefined,
      camY: undefined,
    });

    // defaultCamW = 1280 * 0.35 = 448
    // defaultCamH = 720 * 0.45 = 324
    // defaultCamX = 1280 - 448 = 832 (bottom-right)
    // defaultCamY = 720 - 324 = 396 (bottom-right)
    assert.ok(
      graph.filterComplex.includes('crop=448:324:832:396'),
      `Default webcam should anchor to bottom-right corner (832:396), got: ${graph.filterComplex}`
    );
  });

  await t.test('Case 3: out-of-bound cam coordinates are clamped within source video boundaries', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: 2000, // beyond frame
      camY: 1500, // beyond frame
      camW: 448,
      camH: 324,
    });

    // Must clamp to max allowable (1280 - 448 = 832, 720 - 324 = 396)
    assert.ok(
      graph.filterComplex.includes('crop=448:324:832:396'),
      `OutOfBounds camX/Y must be clamped safely, got: ${graph.filterComplex}`
    );
  });
});
