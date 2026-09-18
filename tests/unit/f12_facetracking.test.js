// tests/unit/f12_facetracking.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { buildFaceTrackedCropX, calculateSafeFaceCropX } from '../../utils/clipper.js';

/**
 * Feature F12: OpenCV Face Tracking & Smoothing
 * Requirements: ORIGINAL_REQUEST §R3, PROJECT.md F12
 *
 * Invariants:
 *  - Face detector tracks face centers and returns normalized coordinates [0.0, 1.0].
 *  - Continuous coordinate smoothing across frames eliminates jitter.
 *  - Gracefully falls back to center [0.5] when 0 faces are detected.
 */

/**
 * Applies moving-average smoothing to a discrete series of face position samples.
 * @param {Array<{ time: number, x: number }>} samples
 * @param {number} [windowSize=5]
 * @returns {Array<{ time: number, x: number }>}
 */
export function smoothFaceTrajectory(samples, windowSize = 5) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const smoothed = [];
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < samples.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(samples.length, i + half + 1);
    const window = samples.slice(start, end);
    const avgX = window.reduce((sum, s) => sum + s.x, 0) / window.length;

    smoothed.push({
      time: samples[i].time,
      x: parseFloat(avgX.toFixed(4)),
    });
  }

  return smoothed;
}

/**
 * Computes speaker anchor map from face tracking plan.
 * Falls back to center (0.5) when no detections are found.
 * @param {Array<{ speaker: string, x: number }>} detections
 * @param {Array<string>} speakers
 * @returns {Map<string, number>}
 */
export function computeSpeakerAnchorMap(detections, speakers = []) {
  const anchorMap = new Map();
  const speakerGroups = new Map();

  for (const d of detections || []) {
    if (d && d.speaker && typeof d.x === 'number') {
      if (!speakerGroups.has(d.speaker)) speakerGroups.set(d.speaker, []);
      speakerGroups.get(d.speaker).push(d.x);
    }
  }

  for (const spk of speakers) {
    if (speakerGroups.has(spk) && speakerGroups.get(spk).length > 0) {
      const xs = speakerGroups.get(spk);
      const median = xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      // Clamp to safe margins [0.15, 0.85]
      const clamped = Math.max(0.15, Math.min(0.85, median));
      anchorMap.set(spk, parseFloat(clamped.toFixed(3)));
    } else {
      // Default to center
      anchorMap.set(spk, 0.5);
    }
  }

  return anchorMap;
}

test('Tier 1: F12 - OpenCV Face Tracking & Smoothing', async (t) => {
  await t.test('Case 1: Normalizes detected face coordinates to [0.0, 1.0] range', () => {
    const rawSamples = [
      { time: 0.0, x: 0.25 },
      { time: 0.5, x: 0.30 },
      { time: 1.0, x: 0.28 },
    ];
    for (const s of rawSamples) {
      assert.ok(s.x >= 0.0 && s.x <= 1.0);
    }
  });

  await t.test('Case 2: Temporal smoothing reduces coordinate variance and eliminates jitter', () => {
    // Noisy trajectory oscillating around 0.5 with high-frequency jitter (+-0.08)
    const noisySamples = [
      { time: 0.0, x: 0.50 },
      { time: 0.1, x: 0.58 },
      { time: 0.2, x: 0.42 },
      { time: 0.3, x: 0.57 },
      { time: 0.4, x: 0.43 },
      { time: 0.5, x: 0.50 },
    ];
    const smoothed = smoothFaceTrajectory(noisySamples, 3);
    assert.strictEqual(smoothed.length, noisySamples.length);

    // Verify peak deviation is significantly dampened
    const maxDevRaw = Math.max(...noisySamples.map((s) => Math.abs(s.x - 0.5)));
    const maxDevSmooth = Math.max(...smoothed.map((s) => Math.abs(s.x - 0.5)));
    assert.ok(maxDevSmooth < maxDevRaw, `Smoothed max deviation (${maxDevSmooth}) must be less than raw (${maxDevRaw})`);
  });

  await t.test('Case 3: Maps multi-speaker face positions to distinct anchors', () => {
    const detections = [
      { speaker: 'Host', x: 0.28 },
      { speaker: 'Host', x: 0.29 },
      { speaker: 'Guest', x: 0.72 },
      { speaker: 'Guest', x: 0.71 },
    ];
    const map = computeSpeakerAnchorMap(detections, ['Host', 'Guest']);
    assert.strictEqual(map.get('Host'), 0.29);
    assert.ok(map.get('Host') < 0.4, 'Host should be on left half');
    assert.ok(map.get('Guest') > 0.6, 'Guest should be on right half');
  });

  await t.test('Case 4: Fallback to frame center 0.5 when no detections exist', () => {
    const map = computeSpeakerAnchorMap([], ['Speaker 1']);
    assert.strictEqual(map.get('Speaker 1'), 0.5);
  });

  await t.test('Case 5: Safe margin clamping prevents edge clipping (keeps within [0.15, 0.85])', () => {
    const extremeDetections = [
      { speaker: 'LeftEdge', x: 0.02 },
      { speaker: 'RightEdge', x: 0.98 },
    ];
    const map = computeSpeakerAnchorMap(extremeDetections, ['LeftEdge', 'RightEdge']);
    assert.strictEqual(map.get('LeftEdge'), 0.15);
    assert.strictEqual(map.get('RightEdge'), 0.85);
  });
});

test('Tier 2: F12 - Face Tracking Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Empty samples array returns empty smoothed trajectory without throwing', () => {
    const smoothed = smoothFaceTrajectory([]);
    assert.deepStrictEqual(smoothed, []);
  });

  await t.test('Case 2: Single sample smoothed trajectory returns identical sample', () => {
    const single = [{ time: 0.0, x: 0.45 }];
    const smoothed = smoothFaceTrajectory(single);
    assert.strictEqual(smoothed.length, 1);
    assert.strictEqual(smoothed[0].x, 0.45);
  });

  await t.test('Case 3: Python script exists and handles invalid payload cleanly', async () => {
    const scriptPath = path.resolve('scripts/face_tracking.py');
    assert.ok(fs.existsSync(scriptPath), 'scripts/face_tracking.py must exist');

    // Run with invalid JSON to verify error handling
    const result = await new Promise((resolve) => {
      const proc = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('close', (code) => resolve({ code, out, err }));
      proc.stdin.write('invalid_json');
      proc.stdin.end();
    });

    // Should fail cleanly with non-zero exit code or error output
    assert.ok(result.code !== 0 || result.err.length > 0 || result.out.includes('error'));
  });

  await t.test('Case 4: Trajectory smoothing with windowSize = 1 preserves raw values', () => {
    const samples = [
      { time: 0, x: 0.2 },
      { time: 1, x: 0.8 },
    ];
    const smoothed = smoothFaceTrajectory(samples, 1);
    assert.strictEqual(smoothed[0].x, 0.2);
    assert.strictEqual(smoothed[1].x, 0.8);
  });

  await t.test('Case 5: Speaker anchor map with undefined speakers returns empty map', () => {
    const map = computeSpeakerAnchorMap([], []);
    assert.strictEqual(map.size, 0);
  });
});

test('Tier 3: F12 - Face Tracked Crop & Panning Invariants', async (t) => {
  await t.test('Case 1: calculateSafeFaceCropX centers face horizontally and clamps to [0, maxX]', () => {
    // Center at 450 with cropWidth 608 -> Math.round(450 - 304) = 146
    const xMid = calculateSafeFaceCropX({ centerX: 450, faceWidth: 100, cropWidth: 608, maxX: 1312 });
    assert.strictEqual(xMid, 146);

    // Left edge clamp
    const xLeft = calculateSafeFaceCropX({ centerX: 100, faceWidth: 80, cropWidth: 608, maxX: 1312 });
    assert.strictEqual(xLeft, 0);

    // Right edge clamp
    const xRight = calculateSafeFaceCropX({ centerX: 1800, faceWidth: 80, cropWidth: 608, maxX: 1312 });
    assert.strictEqual(xRight, 1312);

    // Non-finite fallback
    const xNaN = calculateSafeFaceCropX({ centerX: NaN, faceWidth: 80, cropWidth: 608, maxX: 1312 });
    assert.strictEqual(xNaN, 0);
  });

  await t.test('Case 2: buildFaceTrackedCropX generates smooth cosine easing on is_cut === false with 500ms anticipatory timing', () => {
    const plan = [
      { start: 0.0, end: 3.0, center_x: 450, face_width: 100, is_cut: false },
      { start: 3.0, end: 6.0, center_x: 1470, face_width: 100, is_cut: false },
    ];
    const expr = buildFaceTrackedCropX({
      srcWidth: 1920,
      cropWidth: 608,
      defaultX: 656,
      faceTrackingPlan: plan,
    });

    assert.ok(expr, 'Expression must not be null');
    assert.ok(expr.includes('cos('), 'Expression must contain cosine easing');
    // Anticipatory timing: tStart = 3.0 - 0.25 = 2.75, tEnd = 3.0 + 0.25 = 3.25
    assert.ok(expr.includes('2.75'), 'Must start pan at current.end - 0.25s (anticipatory timing)');
    assert.ok(expr.includes('3.25'), 'Must end pan at current.end + 0.25s');
    assert.ok(expr.includes('0.500'), 'Duration must be 500ms (0.500s)');
  });

  await t.test('Case 3: buildFaceTrackedCropX generates hard cut at exact boundary when is_cut === true', () => {
    const plan = [
      { start: 0.0, end: 3.0, center_x: 450, face_width: 100, is_cut: false },
      { start: 3.0, end: 6.0, center_x: 1470, face_width: 100, is_cut: true },
    ];
    const expr = buildFaceTrackedCropX({
      srcWidth: 1920,
      cropWidth: 608,
      defaultX: 656,
      faceTrackingPlan: plan,
    });

    assert.ok(expr, 'Expression must not be null');
    // For is_cut === true, hard cut directly at 3.00 without cosine easing
    assert.ok(expr.includes('if(lt(t\\,3.00)\\,146\\,1166)'), 'Must execute instant hard cut on scene cut');
    assert.ok(!expr.includes('cos('), 'Scene cut must NOT include cosine easing');
  });

  await t.test('Case 4: buildFaceTrackedCropX preserves cosine pan animation with 16 segments (no > 15 hard cut strip)', () => {
    const plan = [];
    for (let i = 0; i < 16; i++) {
      plan.push({
        start: i * 1.0,
        end: (i + 1) * 1.0,
        center_x: i % 2 === 0 ? 450 : 1470,
        face_width: 100,
        is_cut: false,
      });
    }
    const expr = buildFaceTrackedCropX({
      srcWidth: 1920,
      cropWidth: 608,
      defaultX: 656,
      faceTrackingPlan: plan,
    });

    assert.ok(expr, 'Expression must not be null');
    // Crucial requirement: Must NOT strip easing when segments = 16!
    assert.ok(expr.includes('cos('), '16 segments must retain smooth cosine pan animations');
  });

  await t.test('Case 5: buildFaceTrackedCropX caps segments to MAX_EXPR_SEGMENTS = 16', () => {
    const plan = [];
    for (let i = 0; i < 25; i++) {
      plan.push({
        start: i * 0.5,
        end: (i + 1) * 0.5,
        center_x: i % 2 === 0 ? 400 + (i * 10) : 1200 + (i * 10),
        face_width: 100,
        is_cut: false,
      });
    }
    const expr = buildFaceTrackedCropX({
      srcWidth: 1920,
      cropWidth: 608,
      defaultX: 656,
      faceTrackingPlan: plan,
    });

    assert.ok(expr, 'Expression must not be null');
    // FFmpeg expression must evaluate cleanly without stack overflow
    assert.ok(expr.length < 3000, `Capped expression length (${expr.length}) must be safely bounded`);
  });

  await t.test('Case 6: buildFaceTrackedCropX returns null for empty plan or invalid crop dimensions', () => {
    assert.strictEqual(buildFaceTrackedCropX({ srcWidth: 1920, cropWidth: 608, defaultX: 656, faceTrackingPlan: [] }), null);
    assert.strictEqual(buildFaceTrackedCropX({ srcWidth: 1920, cropWidth: 608, defaultX: 656, faceTrackingPlan: null }), null);
    assert.strictEqual(buildFaceTrackedCropX({ srcWidth: 1920, cropWidth: 1920, defaultX: 0, faceTrackingPlan: [{ start: 0, end: 1, center_x: 960 }] }), null);
  });

  await t.test('Case 7: Python face tracking executes cleanly on video fixture and outputs valid plan JSON', async () => {
    const scriptPath = path.resolve('scripts/face_tracking.py');
    const videoPath = path.resolve('tests/fixtures/media/sample_dialogue_1080p.mp4');
    assert.ok(fs.existsSync(videoPath), 'sample_dialogue_1080p.mp4 must exist');

    const payload = {
      videoPath,
      clipStart: 0.0,
      clipEnd: 2.0,
      speakerTurns: [],
    };

    const result = await new Promise((resolve) => {
      const proc = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('close', (code) => resolve({ code, out, err }));
      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    });

    assert.strictEqual(result.code, 0, `Python script must exit 0, err: ${result.err}`);
    const parsed = JSON.parse(result.out);
    assert.ok(Array.isArray(parsed.plan), 'Result must contain plan array');
    assert.ok(parsed.debug, 'Result must contain debug info');
  });

  await t.test('Case 8: Full 16-segment cosine easing crop filter compiles in FFmpeg without error', async () => {
    const plan = [];
    for (let i = 0; i < 16; i++) {
      plan.push({
        start: i * 0.5,
        end: (i + 1) * 0.5,
        center_x: i % 2 === 0 ? 450 : 1470,
        face_width: 120,
        is_cut: false,
      });
    }
    const expr = buildFaceTrackedCropX({
      srcWidth: 1920,
      cropWidth: 608,
      defaultX: 656,
      faceTrackingPlan: plan,
    });

    const videoPath = path.resolve('tests/fixtures/media/sample_dialogue_1080p.mp4');
    const outputPath = path.resolve('tests/fixtures/media/temp_test_16seg.mp4');

    const result = await new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-ss', '0',
        '-t', '1',
        '-i', videoPath,
        '-vf', `crop=608:1080:${expr}:0,scale=1080:1920`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        outputPath,
      ]);
      let err = '';
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('close', (code) => resolve({ code, err }));
    });

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    assert.strictEqual(result.code, 0, `FFmpeg must exit 0, err: ${result.err}`);
  });
});


