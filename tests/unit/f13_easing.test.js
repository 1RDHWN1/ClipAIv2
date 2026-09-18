// tests/unit/f13_easing.test.js
import test from 'node:test';
import assert from 'node:assert';

/**
 * Feature F13: Smooth Camera Easing (9:16)
 * Requirements: ORIGINAL_REQUEST §R3, AC Visual Cropping & Reframing, PROJECT.md F13
 *
 * Invariant:
 *  - Framing coordinates transition smoothly between speaker shifts.
 *  - Eliminates 1-frame coordinate snapping artifacts (500+ px jumps in 33ms).
 *  - Uses continuous cosine / smoothstep easing windows (0.4s - 0.6s).
 *  - Derivative velocity is strictly bounded: max frame-to-frame delta <= 25px at 30fps for standard speaker pans.
 */

/**
 * Evaluates cosine easing for progress p in [0, 1].
 * @param {number} p
 * @returns {number}
 */
export function cosineEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

/**
 * Evaluates smoothstep easing for progress p in [0, 1].
 * @param {number} p
 * @returns {number}
 */
export function smoothstepEase(p) {
  const clamped = Math.max(0, Math.min(1, p));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Builds a continuous position function x(t) between two speaker positions.
 * @param {number} x1 - Starting x coordinate in pixels
 * @param {number} x2 - Ending x coordinate in pixels
 * @param {number} tStart - Start of transition window (seconds)
 * @param {number} tEnd - End of transition window (seconds)
 * @param {'cosine'|'smoothstep'} [easing='cosine']
 * @returns {(t: number) => number}
 */
export function createCameraTrajectory(x1, x2, tStart, tEnd, easing = 'cosine') {
  const duration = Math.max(0.001, tEnd - tStart);
  const easeFn = easing === 'smoothstep' ? smoothstepEase : cosineEase;

  return (t) => {
    if (t <= tStart) return x1;
    if (t >= tEnd) return x2;
    const p = (t - tStart) / duration;
    return x1 + (x2 - x1) * easeFn(p);
  };
}

/**
 * Builds an FFmpeg crop expression string for a smooth camera transition.
 * Uses trigonometric expressions supported by FFmpeg eval:
 * x1 + (x2 - x1) * (0.5 - 0.5 * cos(PI * (t - tStart) / duration))
 *
 * @param {number} x1
 * @param {number} x2
 * @param {number} tStart
 * @param {number} tEnd
 * @returns {string}
 */
export function buildFFmpegEasingCropX(x1, x2, tStart, tEnd) {
  const dur = (tEnd - tStart).toFixed(3);
  const tStartStr = tStart.toFixed(3);
  const tEndStr = tEnd.toFixed(3);
  const dx = (x2 - x1).toFixed(1);

  // FFmpeg expression:
  // if(lt(t, tStart), x1, if(lt(t, tEnd), x1 + dx * (0.5 - 0.5*cos(PI*(t-tStart)/dur)), x2))
  return `if(lt(t\\,${tStartStr})\\,${x1}\\,if(lt(t\\,${tEndStr})\\,${x1}+(${dx})*(0.5-0.5*cos(3.14159265*(t-${tStartStr})/${dur}))\\,${x2}))`;
}

/**
 * Numerically samples a camera trajectory at a given framerate.
 * @param {(t: number) => number} trajectoryFn
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} [fps=30]
 * @returns {Array<{ frame: number, time: number, x: number, deltaX: number }>}
 */
export function sampleTrajectory(trajectoryFn, startSec, endSec, fps = 30) {
  const dt = 1.0 / fps;
  const samples = [];
  let prevX = trajectoryFn(startSec);

  let frame = 0;
  for (let t = startSec; t <= endSec + 1e-6; t += dt) {
    const x = trajectoryFn(t);
    const deltaX = Math.abs(x - prevX);
    samples.push({
      frame,
      time: parseFloat(t.toFixed(4)),
      x: parseFloat(x.toFixed(2)),
      deltaX: parseFloat(deltaX.toFixed(2)),
    });
    prevX = x;
    frame++;
  }

  return samples;
}

test('Tier 1: F13 - Smooth Camera Easing (9:16)', async (t) => {
  await t.test('Case 1: Cosine easing function starts at 0, ends at 1, and reaches 0.5 at midpoint', () => {
    assert.strictEqual(cosineEase(0), 0);
    assert.strictEqual(cosineEase(1), 1);
    assert.ok(Math.abs(cosineEase(0.5) - 0.5) < 1e-6);
  });

  await t.test('Case 2: Smoothstep easing function starts at 0, ends at 1, and reaches 0.5 at midpoint', () => {
    assert.strictEqual(smoothstepEase(0), 0);
    assert.strictEqual(smoothstepEase(1), 1);
    assert.ok(Math.abs(smoothstepEase(0.5) - 0.5) < 1e-6);
  });

  await t.test('Case 3: Numerical derivative verification - max frame delta <= 25px for 200px speaker pan', () => {
    // 200px pan over 0.5s transition window at 30fps
    const traj = createCameraTrajectory(400, 600, 2.0, 2.5, 'cosine');
    const samples = sampleTrajectory(traj, 1.8, 2.7, 30);

    const maxDelta = Math.max(...samples.map((s) => s.deltaX));
    assert.ok(maxDelta <= 25.0, `Max frame movement (${maxDelta}px) must be <= 25px, eliminating 1-frame snap`);
  });

  await t.test('Case 4: No jump discontinuity at transition boundary points (t = tStart and t = tEnd)', () => {
    const traj = createCameraTrajectory(300, 650, 1.0, 1.5, 'cosine');
    const eps = 1e-5;

    // Left limit vs right limit at tStart = 1.0
    const xBeforeStart = traj(1.0 - eps);
    const xAfterStart = traj(1.0 + eps);
    assert.ok(Math.abs(xAfterStart - xBeforeStart) < 0.1, 'Position must be continuous at tStart');

    // Left limit vs right limit at tEnd = 1.5
    const xBeforeEnd = traj(1.5 - eps);
    const xAfterEnd = traj(1.5 + eps);
    assert.ok(Math.abs(xAfterEnd - xBeforeEnd) < 0.1, 'Position must be continuous at tEnd');
  });

  await t.test('Case 5: buildFFmpegEasingCropX generates valid FFmpeg expression containing cos easing', () => {
    const expr = buildFFmpegEasingCropX(400, 600, 2.0, 2.5);
    assert.ok(expr.includes('cos('));
    assert.ok(expr.includes('3.14159265'));
    assert.ok(expr.includes('0.5-0.5*cos'));
  });
});

test('Tier 2: F13 - Easing Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Zero-movement transition (x1 === x2) maintains perfectly constant position', () => {
    const traj = createCameraTrajectory(500, 500, 1.0, 1.5, 'cosine');
    const samples = sampleTrajectory(traj, 0.8, 1.8, 30);
    for (const s of samples) {
      assert.strictEqual(s.x, 500);
      assert.strictEqual(s.deltaX, 0);
    }
  });

  await t.test('Case 2: Transition at video start (t = 0) evaluates cleanly without negative time error', () => {
    const traj = createCameraTrajectory(200, 400, 0.0, 0.5, 'cosine');
    assert.strictEqual(traj(0.0), 200);
    assert.strictEqual(traj(0.5), 400);
    const mid = traj(0.25);
    assert.ok(Math.abs(mid - 300) < 1.0);
  });

  await t.test('Case 3: Maximum pan across full width (e.g. 800px) over 0.6s maintains smooth velocity', () => {
    const traj = createCameraTrajectory(100, 900, 2.0, 2.6, 'cosine');
    const samples = sampleTrajectory(traj, 1.9, 2.7, 30);
    // Over 18 frames, average velocity is ~44px, peak velocity ~70px (substantially smoother than 800px snap)
    const maxDelta = Math.max(...samples.map((s) => s.deltaX));
    assert.ok(maxDelta < 75.0, `800px pan max delta (${maxDelta}px) must be < 75px`);
  });

  await t.test('Case 4: Clamping handles times far before tStart and far after tEnd', () => {
    const traj = createCameraTrajectory(300, 700, 5.0, 5.5, 'cosine');
    assert.strictEqual(traj(-10.0), 300);
    assert.strictEqual(traj(100.0), 700);
  });

  await t.test('Case 5: Smoothstep easing behaves identically at boundaries to cosine easing', () => {
    const trajCos = createCameraTrajectory(300, 700, 1.0, 1.5, 'cosine');
    const trajStep = createCameraTrajectory(300, 700, 1.0, 1.5, 'smoothstep');

    assert.strictEqual(trajCos(1.0), trajStep(1.0));
    assert.strictEqual(trajCos(1.5), trajStep(1.5));
    assert.strictEqual(trajCos(1.25), trajStep(1.25)); // both are exactly 500 at midpoint
  });
});
