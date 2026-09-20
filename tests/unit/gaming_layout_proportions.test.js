import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  buildGamingStreamerFilterGraph,
  GAMING_CAM_PANEL_H,
  GAMING_GAME_PANEL_H,
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

  await t.test('the content fills its panel completely — no blur, no bars', () => {
    // The user's ask: the main content should look like the original, just with
    // a webcam strip added on top. So the content covers its whole panel with a
    // centred cover-crop — no blurred filler and no black letterbox.
    assert.ok(
      !graph.filterComplex.includes('gblur'),
      'must NOT blur the content panel'
    );
    assert.ok(
      !/pad=\d+:\d+:[^,]*:black/.test(graph.filterComplex),
      'must NOT pad with black bars'
    );
    assert.ok(
      graph.filterComplex.includes(`scale=1080:${GAMING_GAME_PANEL_H}:force_original_aspect_ratio=increase`),
      'the content must cover-fit its panel'
    );
    assert.ok(
      graph.filterComplex.includes(`crop=1080:${GAMING_GAME_PANEL_H}`),
      'the cover-fit must be centred-cropped to the panel size'
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
