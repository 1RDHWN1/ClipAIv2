import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  buildGamingStreamerFilterGraph,
  GAMING_CAM_PANEL_H,
  GAMING_GAME_PANEL_H,
  GAMING_SHARP_H,
} from '../../utils/clipper.js';

// ---------------------------------------------------------------------------
// Gaming layout: smaller webcam, bigger content, no dead black bars.
//
// Reported: the webcam panel was too tall and the main content too small, with
// visible empty space in the middle. Measured on the old layout (1080x1920):
//   webcam 800px (42%), sharp content 607px, black bars 504px (26% of frame).
// The content panel was 1120px but a 16:9 frame fitted to 1080 wide is only
// 607px tall, so `pad=black` wasted the rest.
// ---------------------------------------------------------------------------

test('Gaming layout: webcam smaller, content larger, no black bars', async (t) => {
  const graph = buildGamingStreamerFilterGraph({ srcWidth: 1920, srcHeight: 1080 });

  await t.test('the webcam panel is a small fraction of the frame', () => {
    assert.ok(
      GAMING_CAM_PANEL_H / 1920 <= 0.25,
      `webcam panel is ${(GAMING_CAM_PANEL_H / 1920 * 100).toFixed(0)}% of the frame — too tall`
    );
  });

  await t.test('the panels exactly fill the frame', () => {
    assert.strictEqual(
      GAMING_CAM_PANEL_H + GAMING_GAME_PANEL_H, 1920,
      'the two panels must sum to the frame height with no gap'
    );
  });

  await t.test('the content panel is the majority of the frame', () => {
    assert.ok(
      GAMING_GAME_PANEL_H / 1920 >= 0.75,
      `content panel is only ${(GAMING_GAME_PANEL_H / 1920 * 100).toFixed(0)}% of the frame`
    );
  });

  await t.test('the content is bigger than a plain fit but not over-zoomed', () => {
    // A plain 16:9 fit at 1080 wide is 607px tall. We want it bigger, but a
    // 16:9 source in a 9:16 frame can only grow by cropping the sides, so cap
    // the zoom so no more than ~40% of the width is lost.
    const fitHeight = Math.round(1080 * 9 / 16);
    assert.ok(
      GAMING_SHARP_H > fitHeight,
      `sharp content (${GAMING_SHARP_H}px) must exceed the plain fit (${fitHeight}px)`
    );
    const sourceWidth = GAMING_SHARP_H * 16 / 9;
    const croppedRatio = (sourceWidth - 1080) / sourceWidth;
    assert.ok(
      croppedRatio <= 0.40,
      `zooming to ${GAMING_SHARP_H}px crops ${(croppedRatio * 100).toFixed(0)}% of the width — too much`
    );
    assert.ok(
      graph.filterComplex.includes(`scale=1080:${GAMING_SHARP_H}`),
      'the sharp content must be scaled to GAMING_SHARP_H'
    );
  });

  await t.test('the letterbox is filled with a blurred copy, never black', () => {
    assert.ok(graph.filterComplex.includes('gblur'), 'must use a gaussian blur fill');
    assert.ok(
      !/pad=\d+:\d+:[^,]*:black/.test(graph.filterComplex),
      'must not pad with black bars'
    );
    assert.ok(
      /\[gamebg\]\[gamefg\]overlay=/.test(graph.filterComplex),
      'the sharp content must be overlaid on the blurred fill'
    );
  });

  await t.test('the filter graph is syntactically valid and renders', () => {
    // ffmpeg parses the graph and produces a frame; a broken graph fails here.
    const src = '/tmp/sec_1318.mp4';
    if (!fs.existsSync(src)) {
      t.skip('sample clip not present');
      return;
    }
    const out = '/tmp/_layout_probe.png';
    execFileSync('ffmpeg', [
      '-y', '-ss', '2', '-i', src,
      '-filter_complex', graph.filterComplex,
      '-map', graph.outputMap,
      '-vframes', '1', out,
    ], { stdio: 'ignore', timeout: 120000 });
    assert.ok(fs.existsSync(out), 'ffmpeg must produce a frame');
  });
});
