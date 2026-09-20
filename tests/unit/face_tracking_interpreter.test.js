import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolveFaceTrackingPython } from '../../utils/clipper.js';

// ---------------------------------------------------------------------------
// The silent-webcam-failure bug.
//
// The clipper spawned `python` (the system interpreter) for face_tracking.py.
// System Python usually has no cv2, so the script died with ImportError, the
// clipper swallowed it, webcamBox became null, and a real gaming stream got
// cropped to its content instead of the streamer — with no visible error.
//
// resolveFaceTrackingPython() probes for an interpreter that can actually
// `import cv2, numpy` instead of trusting a bare name.
// ---------------------------------------------------------------------------

test('Face tracking interpreter: resolved to one that has cv2', async (t) => {
  await t.test('the resolved interpreter can import cv2 and numpy', () => {
    const bin = resolveFaceTrackingPython();
    assert.ok(bin && typeof bin === 'string', 'must return an interpreter path/name');
    const r = spawnSync(bin, ['-c', 'import cv2, numpy'], { timeout: 30000 });
    assert.strictEqual(
      r.status, 0,
      `resolved interpreter "${bin}" cannot import cv2/numpy — face tracking would fail silently`
    );
  });

  await t.test('the clipper no longer hardcodes a bare "python"', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('utils/clipper.js', 'utf-8')
    );
    assert.ok(
      /resolveFaceTrackingPython/.test(src),
      'the interpreter must be resolved by probing, not hardcoded'
    );
    assert.ok(
      !/FACE_TRACKING_PYTHON\s*=\s*process\.env\.FACE_TRACKING_PYTHON\s*\|\|\s*'python';/.test(src),
      'the bare `|| \'python\'` fallback must be gone'
    );
  });

  await t.test('a tracker failure is reported, not swallowed into an empty array', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('utils/clipper.js', 'utf-8')
    );
    // The old bug: `return [];` made trackingResult.webcamBox undefined with no
    // trace. It must return the same shape as the success path.
    const fnStart = src.indexOf('async function getFaceTrackingPlan');
    const fnBody = src.slice(fnStart, fnStart + 3000);
    assert.ok(
      /Face tracking GAGAL/.test(fnBody),
      'a tracker error must be logged loudly'
    );
    assert.ok(
      !/if \(result\.error\) \{[\s\S]{0,200}?return \[\];/.test(fnBody),
      'a tracker error must not return a bare empty array'
    );
  });
});
