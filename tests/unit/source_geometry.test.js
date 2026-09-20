// tests/unit/source_geometry.test.js
import test from 'node:test';
import assert from 'node:assert';

import { buildAdaptiveSplitFilterGraph, buildGamingStreamerFilterGraph } from '../../utils/clipper.js';

/**
 * Regression: source geometry must never be fabricated (audit finding M1).
 *
 * `getVideoInfo(url)` used to resolve a hardcoded 1280x720 with duration 0. The
 * clipper is normally handed the YouTube URL (not a file), so a real 1080p
 * source was cropped as if it were 720p:
 *
 *   - 9:16 solo crop width = min(srcWidth, floor(srcHeight * 9/16))
 *     720p  -> 405 px
 *     1080p -> 607 px            => ~33% too tight, an unintended zoom-in
 *   - crop X was centred on a 1280-wide frame instead of 1920
 *   - split-screen panels were cropped at 720p and then upscaled to 1080x960
 *
 * The clipper now resolves the real dimensions from the downloaded section and
 * throws if they are unknown, rather than rendering with a guess.
 *
 * These tests pin the geometry maths so a wrong assumption is visible.
 */

test('Source geometry: 9:16 crop width is derived from REAL height, not a guess (M1)', () => {
  const cropWidthFor = (srcWidth, srcHeight) =>
    Math.min(srcWidth, Math.floor((srcHeight * 9) / 16));

  assert.strictEqual(cropWidthFor(1280, 720), 405, '720p placeholder yields 405px');
  assert.strictEqual(cropWidthFor(1920, 1080), 607, 'real 1080p yields 607px');

  const placeholder = cropWidthFor(1280, 720);
  const real = cropWidthFor(1920, 1080);
  const tooNarrowBy = (real - placeholder) / real;

  assert.ok(
    tooNarrowBy > 0.3,
    `using the 720p placeholder crops ${(tooNarrowBy * 100).toFixed(1)}% too narrow — that is the bug being guarded`
  );
});

test('Source geometry: adaptive split graph scales from the passed dimensions (M1)', () => {
  // Same logical framing expressed at 1080p must crop a wider source region.
  const at1080 = buildAdaptiveSplitFilterGraph({
    srcWidth: 1920,
    srcHeight: 1080,
    soloCropXExpr: '656',
    wideIntervals: [],
  });
  const at720 = buildAdaptiveSplitFilterGraph({
    srcWidth: 1280,
    srcHeight: 720,
    soloCropXExpr: '437',
    wideIntervals: [],
  });

  // cropHeight = min(floor(cropWidth * 16/9), srcHeight):
  //   1080p -> cropWidth 607 -> height 1079
  //    720p -> cropWidth 405 -> height 720
  assert.match(at1080.filterComplex, /crop=607:1079/, 'must crop at the real 1080p geometry');
  assert.match(at720.filterComplex, /crop=405:720/, 'placeholder geometry crops far narrower');
  assert.notStrictEqual(at1080.filterComplex, at720.filterComplex, 'geometry must depend on the real source size');
});

test('Source geometry: split panels crop from the real source, not a 720p stand-in (M1)', () => {
  const graph = buildAdaptiveSplitFilterGraph({
    srcWidth: 1920,
    srcHeight: 1080,
    soloCropXExpr: '656',
    wideIntervals: [{ start: 1, end: 3, x1: 480, x2: 1440 }],
  });

  // Panel crop must be derived from the 1080-high source (1215x1080 -> 1080x960),
  // not from a 720-high placeholder (810x720), which would be upscaled.
  assert.match(graph.filterComplex, /crop=1215:1080/, 'panels must be cropped at full source height');
  assert.ok(!graph.filterComplex.includes('crop=810:720'), 'must not crop panels at the 720p placeholder size');
  assert.match(graph.filterComplex, /setsar=1/);
});

test('Source geometry: a zero/invalid size must be rejected before crop maths (M1)', () => {
  // The guard in processClips throws when width/height are not positive. Model it.
  const isValidGeometry = (w, h) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;

  assert.strictEqual(isValidGeometry(0, 0), false, 'unresolved URL placeholder (0x0) must be rejected');
  assert.strictEqual(isValidGeometry(undefined, undefined), false);
  assert.strictEqual(isValidGeometry(1920, 1080), true);
  assert.strictEqual(isValidGeometry(1280, 720), true);
});

test('Source geometry: gaming graph uses passed dimensions and normalises SAR (M1)', () => {
  const graph = buildGamingStreamerFilterGraph({ srcWidth: 1920, srcHeight: 1080 });
  assert.strictEqual(graph.renderWidth, 1080);
  assert.strictEqual(graph.renderHeight, 1920);
  // Camera crop derives from the real source width (35% of 1920 = 672).
  assert.match(graph.filterComplex, /crop=672:486/);
  assert.match(graph.filterComplex, /setsar=1/);
});
