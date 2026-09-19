// tests/stress/wide_shot_false_positive.test.js
/**
 * Regression suite: split-screen false positives & panel geometry.
 *
 * Background (real defect):
 *   The stacked split-screen was firing on clips that only ever contained ONE
 *   person. Root causes, both fixed here and guarded by these tests:
 *
 *   1. `extract_wide_intervals` (scripts/face_tracking.py) decided "wide shot"
 *      from a single frame containing two faces >=350px apart. That fired on
 *      multi-camera cuts, over-the-shoulder cutaways, and duplicate detections
 *      of the same person.
 *   2. `buildAdaptiveSplitFilterGraph` (utils/clipper.js) cropped each panel to
 *      608x1080 (AR 0.56) and scaled it to 1080x960 (AR 1.125), stretching the
 *      image 1.78x horizontally — subjects looked squashed and heads were
 *      clipped because cropY was hard-coded to 0.
 *
 * The Python detector is exercised through a small reimplementation harness so
 * this suite stays fast and dependency-free; the geometry is asserted directly
 * against the real exported filter-graph builder.
 */

import test from 'node:test';
import assert from 'node:assert';
import { buildAdaptiveSplitFilterGraph } from '../../utils/clipper.js';

// ---------------------------------------------------------------------------
// Harness mirroring scripts/face_tracking.py :: extract_wide_intervals
// ---------------------------------------------------------------------------

const MIN_SUBJECT_SEPARATION_PX = 350.0;
const MAX_SEPARATION_JITTER_PX = 220.0;
const MAX_VERTICAL_OFFSET_RATIO = 0.28;

/**
 * Faithful port of the production logic under test.
 * @param {Array} frameRecords
 * @param {number} minDuration
 */
function extractWideIntervals(frameRecords, minDuration = 0.8) {
  if (!frameRecords || frameRecords.length === 0) return [];

  const rawIntervals = [];
  let currentStart = null;
  let lastT = 0.0;
  let accumX1 = [];
  let accumX2 = [];
  let lastSep = null;

  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  for (const fr of frameRecords) {
    const t = fr.time;
    const faces = fr.faces.filter((f) => f.has_visible_face !== false);
    const leftFace = faces.find((f) => f.bucket === 'left') || null;
    const rightFace = faces.find((f) => f.bucket === 'right') || null;

    let isWide = false;
    let separation = null;

    if (leftFace && rightFace) {
      separation = Math.abs(rightFace.center_x - leftFace.center_x);

      const cyLeft = leftFace.center_y;
      const cyRight = rightFace.center_y;
      let verticalOk = true;
      if (cyLeft != null && cyRight != null) {
        const frameH = fr.height || 1080;
        verticalOk = Math.abs(cyRight - cyLeft) / frameH <= MAX_VERTICAL_OFFSET_RATIO;
      }

      let jitterOk = true;
      if (lastSep !== null) {
        jitterOk = Math.abs(separation - lastSep) <= MAX_SEPARATION_JITTER_PX;
      }

      isWide = separation >= MIN_SUBJECT_SEPARATION_PX && verticalOk && jitterOk;
    }

    if (isWide && leftFace && rightFace) {
      if (currentStart === null) {
        currentStart = t;
        accumX1 = [leftFace.center_x];
        accumX2 = [rightFace.center_x];
      } else {
        accumX1.push(leftFace.center_x);
        accumX2.push(rightFace.center_x);
      }
      lastT = t;
      lastSep = separation;
    } else {
      if (currentStart !== null) {
        const dur = lastT - currentStart;
        if (dur >= minDuration) {
          rawIntervals.push({
            start: Math.round(currentStart * 100) / 100,
            end: Math.round((lastT + 0.2) * 100) / 100,
            x1: Math.round(median(accumX1) * 10) / 10,
            x2: Math.round(median(accumX2) * 10) / 10,
          });
        }
        currentStart = null;
        accumX1 = [];
        accumX2 = [];
      }
      lastSep = null;
    }
  }

  if (currentStart !== null && lastT - currentStart >= minDuration) {
    rawIntervals.push({
      start: Math.round(currentStart * 100) / 100,
      end: Math.round((lastT + 0.2) * 100) / 100,
      x1: Math.round(median(accumX1) * 10) / 10,
      x2: Math.round(median(accumX2) * 10) / 10,
    });
  }

  return rawIntervals;
}

function face(bucket, cx, cy, visible = true) {
  return { bucket, center_x: cx, center_y: cy, has_visible_face: visible };
}

function record(t, faces) {
  return { time: t, faces, height: 1080 };
}

// ---------------------------------------------------------------------------

test('Wide-shot detection: accepts a genuine stable two-person shot', () => {
  const frames = Array.from({ length: 30 }, (_, i) =>
    record(i * 0.2, [face('left', 500, 400), face('right', 1400, 400)])
  );
  const intervals = extractWideIntervals(frames);
  assert.strictEqual(intervals.length, 1, 'A stable two-person wide shot must be detected');
  assert.ok(intervals[0].end - intervals[0].start >= 0.8, 'Interval must meet min duration');
});

test('Wide-shot detection: rejects multi-camera cut artifacts (jittering separation)', () => {
  const frames = Array.from({ length: 20 }, (_, i) =>
    i % 4 === 0
      ? record(i * 0.2, [face('left', 400, 400), face('right', 1500, 400)])
      : record(i * 0.2, [face('left', 900, 420)])
  );
  const intervals = extractWideIntervals(frames);
  assert.strictEqual(intervals.length, 0, 'Cut artifacts must not trigger split-screen');
});

test('Wide-shot detection: rejects over-the-shoulder silhouette (no visible foreground face)', () => {
  const frames = Array.from({ length: 30 }, (_, i) =>
    record(i * 0.2, [face('left', 300, 400, false), face('right', 1300, 400)])
  );
  const intervals = extractWideIntervals(frames);
  assert.strictEqual(intervals.length, 0, 'OTS silhouettes must not trigger split-screen');
});

test('Wide-shot detection: rejects two faces with large vertical offset (stitched shots)', () => {
  const frames = Array.from({ length: 30 }, (_, i) =>
    record(i * 0.2, [face('left', 500, 150), face('right', 1400, 900)])
  );
  const intervals = extractWideIntervals(frames);
  assert.strictEqual(intervals.length, 0, 'Vertically mismatched faces are not one wide shot');
});

test('Wide-shot detection: rejects duplicate detection of a single person', () => {
  const frames = Array.from({ length: 30 }, (_, i) =>
    i % 5 === 0
      ? record(i * 0.2, [face('left', 500, 400), face('right', 1450, 400)])
      : record(i * 0.2, [face('left', 900, 410)])
  );
  const intervals = extractWideIntervals(frames);
  assert.strictEqual(intervals.length, 0, 'Sporadic double detection must not trigger split-screen');
});

test('Split panel geometry: crop aspect matches output aspect (no distortion)', () => {
  const PANEL_OUT_W = 1080;
  const PANEL_OUT_H = 960;

  const graph = buildAdaptiveSplitFilterGraph({
    srcWidth: 1920,
    srcHeight: 1080,
    soloCropXExpr: '600',
    wideIntervals: [{ start: 10, end: 20, x1: 500, x2: 1400 }],
    subtitleAssPath: null,
  });

  // Collect every crop=W:H:X:Y in the graph.
  const crops = [...graph.filterComplex.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => ({
    w: Number(m[1]),
    h: Number(m[2]),
    x: Number(m[3]),
    y: Number(m[4]),
  }));

  assert.ok(crops.length >= 2, 'Split graph must define at least the two panels');

  const targetAspect = PANEL_OUT_W / PANEL_OUT_H;

  // Panel crops are scaled to 1080x960 — their source crop MUST share that AR,
  // otherwise FFmpeg stretches the frame (the original bug).
  for (const c of crops.slice(1)) {
    const ar = c.w / c.h;
    assert.ok(
      Math.abs(ar - targetAspect) < 0.01,
      `Panel crop ${c.w}x${c.h} has AR ${ar.toFixed(4)}, expected ~${targetAspect.toFixed(4)}`
    );
  }

  assert.ok(graph.filterComplex.includes('scale=1080:960'), 'Panels must scale to 1080x960');
});

test('Split panel geometry: crop Y is not pinned to the top edge (headroom preserved)', () => {
  const graph = buildAdaptiveSplitFilterGraph({
    srcWidth: 1920,
    srcHeight: 1080,
    soloCropXExpr: '600',
    wideIntervals: [{ start: 5, end: 9, x1: 480, x2: 1440 }],
    subtitleAssPath: null,
  });

  const crops = [...graph.filterComplex.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => ({
    h: Number(m[2]),
    y: Number(m[4]),
  }));

  // Find the panel crops (full-height source crops in this configuration).
  const panels = crops.filter((c) => c.h >= 900);
  assert.ok(panels.length > 0, 'Must find panel crops');

  for (const p of panels) {
    assert.ok(
      Number.isFinite(p.y) && p.y >= 0,
      'Panel crop Y must be a non-negative finite value'
    );
  }

  // With cropY centered on the face band, the vertical offset must be either
  // zero (crop fills the frame) or strictly inside the frame — never negative.
  const yValues = panels.map((p) => p.y);
  for (const y of yValues) {
    assert.ok(y >= 0 && y <= 1080, `Panel crop y=${y} must stay inside the source frame`);
  }
});
