import test from 'node:test';
import assert from 'node:assert';
import {
  resolveLayoutMode,
  webcamPerFrameScore,
  buildGamingStreamerFilterGraph,
  GAMING_WEBCAM_MIN_PER_FRAME,
} from '../../utils/clipper.js';

// ---------------------------------------------------------------------------
// The "forced gaming layout" bug.
//
// A user picked "🎮 Gaming Streamer (Cam + Gameplay)" for an iPhone-unboxing /
// reaction video. The scene was NOT a gaming stream, so there was no webcam to
// find — yet the layout was forced anyway and the filter graph cropped a blind
// corner while the subject sat in the middle. Two fixes are pinned here:
//   1. gaming_streamer is only honoured when a webcam is actually detected.
//   2. the no-webcam default crop is CENTRED, not bottom-right.
// ---------------------------------------------------------------------------

const realWebcam = {
  x: 67, y: 290, width: 437, height: 324,
  quadrant: 'bottom_left', per_frame_score: 0.55, detections: 295,
};

const weakWebcam = {
  x: 832, y: 396, width: 448, height: 324,
  quadrant: 'bottom_right', per_frame_score: 0.20, detections: 295,
};

test('Layout guard: gaming_streamer is not forced onto non-gaming scenes', async (t) => {
  await t.test('manual gaming_streamer WITHOUT a webcam falls back to auto_split', () => {
    const r = resolveLayoutMode('gaming_streamer', null);
    assert.strictEqual(r.layoutMode, 'auto_split', 'must not force the gaming layout with no webcam');
    assert.strictEqual(r.webcamIsUsable, false);
    assert.match(r.reason, /tidak ada webcam/i);
  });

  await t.test('manual gaming_streamer with only a WEAK signal also falls back', () => {
    const r = resolveLayoutMode('gaming_streamer', weakWebcam);
    assert.strictEqual(r.layoutMode, 'auto_split');
    assert.strictEqual(r.webcamIsUsable, false);
    assert.match(r.reason, /terlalu lemah/i);
  });

  await t.test('manual gaming_streamer WITH a real webcam is honoured', () => {
    const r = resolveLayoutMode('gaming_streamer', realWebcam);
    assert.strictEqual(r.layoutMode, 'gaming_streamer');
    assert.strictEqual(r.webcamIsUsable, true);
    assert.ok(r.reason, 'should explain why the layout was kept');
  });

  await t.test('auto_split upgrades only on a genuine webcam', () => {
    assert.strictEqual(resolveLayoutMode('auto_split', realWebcam).layoutMode, 'gaming_streamer');
    assert.strictEqual(resolveLayoutMode('auto_split', weakWebcam).layoutMode, 'auto_split');
    assert.strictEqual(resolveLayoutMode('auto_split', null).layoutMode, 'auto_split');
  });

  await t.test('a webcamBox with missing geometry is not usable', () => {
    const partial = { quadrant: 'bottom_right', per_frame_score: 0.55 };
    const r = resolveLayoutMode('gaming_streamer', partial);
    assert.strictEqual(r.webcamIsUsable, false, 'x/y/width/height must all be present');
    assert.strictEqual(r.layoutMode, 'auto_split');
  });

  await t.test('other layouts pass through untouched', () => {
    for (const mode of ['standard', 'split_screen']) {
      assert.strictEqual(resolveLayoutMode(mode, null).layoutMode, mode);
      assert.strictEqual(resolveLayoutMode(mode, realWebcam).layoutMode, mode);
    }
  });

  await t.test('the per-frame threshold sits between false and genuine scores', () => {
    assert.ok(
      weakWebcam.per_frame_score < GAMING_WEBCAM_MIN_PER_FRAME,
      'false positive must be below the threshold'
    );
    assert.ok(
      realWebcam.per_frame_score > GAMING_WEBCAM_MIN_PER_FRAME,
      'genuine webcam must be above the threshold'
    );
  });
});

test('webcamPerFrameScore: normalises raw scores by detection count', async (t) => {
  await t.test('prefers an explicit per_frame_score', () => {
    assert.strictEqual(webcamPerFrameScore({ per_frame_score: 0.55, score: 999, detections: 3 }), 0.55);
  });

  await t.test('divides a raw score when per_frame_score is absent', () => {
    assert.ok(Math.abs(webcamPerFrameScore({ score: 8.25, detections: 15 }) - 0.55) < 0.01);
  });

  await t.test('never divides by zero', () => {
    assert.strictEqual(webcamPerFrameScore({ score: 5, detections: 0 }), 5);
    assert.strictEqual(webcamPerFrameScore(null), 0);
  });
});

test('Blind-corner crop: the no-webcam default is centred', async (t) => {
  await t.test('default crop centres instead of anchoring bottom-right', () => {
    const g = buildGamingStreamerFilterGraph({ srcWidth: 1280, srcHeight: 720 });
    // 448x324 box in a 1280x720 frame -> centre is (416, 198)
    assert.ok(
      g.filterComplex.includes('crop=448:324:416:198'),
      `expected a centred crop, got: ${g.filterComplex}`
    );
    assert.ok(
      !g.filterComplex.includes('crop=448:324:832:396'),
      'must not fall back to the bottom-right corner'
    );
  });

  await t.test('explicit webcam coordinates still win', () => {
    const g = buildGamingStreamerFilterGraph({
      srcWidth: 1280, srcHeight: 720, camX: 55, camY: 282, camW: 437, camH: 324,
    });
    assert.ok(
      g.filterComplex.includes('crop=437:324:55:282'),
      `explicit coordinates must be used verbatim, got: ${g.filterComplex}`
    );
  });
});
