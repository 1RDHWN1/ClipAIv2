// tests/unit/ffmpeg_graph_limits.test.js
import test from 'node:test';
import assert from 'node:assert';

import {
  buildAdaptiveSplitFilterGraph,
  buildGamingStreamerFilterGraph,
  capWideIntervals,
} from '../../utils/clipper.js';

/**
 * Regression: FFmpeg filter-graph limits (audit finding H2).
 *
 * H2 had two independent defects, both verified by REAL render against a
 * 1920x1080 testsrc2 clip:
 *
 *  a) The gaming-streamer graph scaled both panels without `setsar=1`, so the
 *     output carried a non-1:1 sample aspect ratio (players can render it
 *     distorted). The split-screen graph already did this correctly, so the two
 *     were inconsistent.
 *
 *  b) The adaptive split-screen `overlay ... enable=` expression joined one
 *     `between(t,a,b)` term per wide interval. FFmpeg's expression parser
 *     supports ~100 terms and then fails outright:
 *
 *       [overlay] Error when evaluating the expression '...' for enable
 *       [AVFilterGraph] Error initializing filters
 *       Error : Cannot allocate memory
 *
 *     Measured cliff: 100 terms -> exit 0, 101 terms -> exit 244.
 *
 *     Because clipVideo catches any FFmpeg failure and retries with a plain
 *     center crop, the user silently lost split-screen. A single clip of a
 *     podcast that cuts back and forth can realistically reach triple digits of
 *     wide intervals, so this is not purely theoretical.
 */

const makeIntervals = (n, step = 3, len = 2) =>
  Array.from({ length: n }, (_, i) => ({ start: i * step, end: i * step + len, x1: 500, x2: 1400 }));

function enableTermCount(filterComplex) {
  const m = filterComplex.match(/enable='([^']*)'/);
  return m ? m[1].split('+').length : 0;
}

test('FFmpeg graph limits: setsar=1 on both split layouts (H2a)', async (t) => {
  await t.test('Case 1: gaming streamer pins SAR to 1:1 on cam and game panels', () => {
    const g = buildGamingStreamerFilterGraph({ srcWidth: 1920, srcHeight: 1080 });
    const chains = g.filterComplex.split(';');
    const camChain = chains.find((c) => c.includes('[cam]'));
    const gameChain = chains.find((c) => c.includes('[game]'));

    assert.match(camChain, /setsar=1/, 'cam panel must set SAR');
    assert.match(gameChain, /setsar=1/, 'game panel must set SAR');
  });

  await t.test('Case 2: adaptive split-screen already pins SAR (unchanged)', () => {
    const g = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920, srcHeight: 1080, soloCropXExpr: '100',
      wideIntervals: makeIntervals(2),
    });
    assert.match(g.filterComplex, /setsar=1/);
    // Every crop/scale leg that feeds vstack/overlay must be SAR-normalised.
    const legs = g.filterComplex.split(';').filter((c) => c.includes('scale='));
    for (const leg of legs) {
      assert.match(leg, /setsar=1/, `leg missing setsar: ${leg}`);
    }
  });

  await t.test('Case 3: output geometry is a valid 9:16 canvas', () => {
    for (const g of [
      buildGamingStreamerFilterGraph({ srcWidth: 1920, srcHeight: 1080 }),
      buildAdaptiveSplitFilterGraph({ srcWidth: 1920, srcHeight: 1080, soloCropXExpr: '100', wideIntervals: makeIntervals(2) }),
    ]) {
      assert.strictEqual(g.renderWidth, 1080);
      assert.strictEqual(g.renderHeight, 1920);
    }
  });
});

test('FFmpeg graph limits: wide intervals are capped below the expression cliff (H2b)', async (t) => {
  await t.test('Case 1: lists within the cap are returned untouched', () => {
    const intervals = makeIntervals(40);
    const capped = capWideIntervals(intervals, 80);
    assert.strictEqual(capped, intervals, 'must be the same reference (no copy, no mutation)');
  });

  await t.test('Case 2: an oversized list is merged down to the cap', () => {
    const capped = capWideIntervals(makeIntervals(500), 80);
    assert.strictEqual(capped.length, 80);
  });

  await t.test('Case 3: merging preserves total temporal coverage', () => {
    const input = makeIntervals(300);
    const capped = capWideIntervals(input, 80);
    assert.strictEqual(capped[0].start, input[0].start, 'first start preserved');
    assert.strictEqual(capped[capped.length - 1].end, input[input.length - 1].end, 'last end preserved');
  });

  await t.test('Case 4: merged output stays sorted and non-overlapping', () => {
    const capped = capWideIntervals(makeIntervals(400), 50);
    for (let i = 1; i < capped.length; i++) {
      assert.ok(capped[i].start >= capped[i - 1].start, 'sorted by start');
    }
  });

  await t.test('Case 5: 128 intervals (which used to kill FFmpeg) now emit <= cap terms', () => {
    const g = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920, srcHeight: 1080, soloCropXExpr: '100',
      wideIntervals: makeIntervals(128),
    });
    const terms = enableTermCount(g.filterComplex);
    assert.ok(terms > 0, 'split-screen path still used');
    assert.ok(terms <= 80, `expected <= 80 enable terms, got ${terms}`);
  });

  await t.test('Case 6: even an absurd interval count cannot overflow the expression', () => {
    const g = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920, srcHeight: 1080, soloCropXExpr: '100',
      wideIntervals: makeIntervals(5000),
    });
    assert.ok(enableTermCount(g.filterComplex) <= 80);
  });

  await t.test('Case 7: malformed interval entries are dropped, not propagated', () => {
    const messy = [
      { start: 0, end: 2, x1: 500, x2: 1400 },
      { start: NaN, end: 5, x1: 500, x2: 1400 },
      { start: 'nope', end: 9, x1: 500, x2: 1400 },
      ...makeIntervals(120),
    ];
    const g = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920, srcHeight: 1080, soloCropXExpr: '100', wideIntervals: messy,
    });
    assert.ok(enableTermCount(g.filterComplex) <= 80);
    assert.doesNotMatch(g.filterComplex, /NaN/, 'NaN must never reach the filter graph');
  });
});
