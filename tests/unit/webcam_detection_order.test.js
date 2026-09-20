import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { resolveFaceTrackingPython } from '../../utils/clipper.js';

const PY = process.env.FACE_TRACKING_PYTHON || resolveFaceTrackingPython();

// ---------------------------------------------------------------------------
// The webcam-deleted-before-detection bug.
//
// main() called build_shot_aware_plan() BEFORE detect_streamer_webcam().
// build_shot_aware_plan mutates frame_records in place, keeping only the
// largest face plus any face at least 35% as wide AND within 35% of the frame
// height of it. A picture-in-picture webcam is small and sits in a far corner,
// so it failed that test and was deleted — then the webcam detector ran on
// data where the webcam no longer existed.
//
// Measured on the real iShowSpeed clip at 13:18 (1920x1080):
//   animation -> centre (991,227), 386px wide  (kept as "primary")
//   webcam    -> centre (407,734), 191px wide  (deleted: |734-227| > 378)
// Result: webcamBox null, and the clip cropped onto the animation.
// ---------------------------------------------------------------------------

test('Webcam detection order: runs on RAW faces before the plan mutates them', async (t) => {
  await t.test('detect_streamer_webcam is called before build_shot_aware_plan', () => {
    const src = fs.readFileSync('scripts/face_tracking.py', 'utf-8');
    const webcamIdx = src.indexOf('webcam_box = detect_streamer_webcam(');
    const planIdx = src.indexOf('plan = build_shot_aware_plan(');
    assert.ok(webcamIdx !== -1, 'detect_streamer_webcam must be called');
    assert.ok(planIdx !== -1, 'build_shot_aware_plan must be called');
    assert.ok(
      webcamIdx < planIdx,
      'detect_streamer_webcam must run BEFORE build_shot_aware_plan, which deletes small corner faces'
    );
  });

  await t.test('a small far-corner face survives the plan filter to reach the detector', () => {
    // Reproduces the mutation: primary 386px, corner face 191px at a very
    // different y. The old filter deleted it; the detector must see it.
    const code = `
import sys, json
sys.path.insert(0, 'scripts')
import face_tracking as ft

records = [{'faces': [
    {'center_x': 991, 'center_y': 227, 'w': 386, 'h': 482, 'has_visible_face': True},
    {'center_x': 407, 'center_y': 734, 'w': 191, 'h': 239, 'has_visible_face': True},
]} for _ in range(60)]

before = ft.detect_streamer_webcam([dict(r, faces=list(r['faces'])) for r in records], 1920, 1080)
print(json.dumps(before))
`;
    const out = execFileSync(PY, ['-c', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000 });
    const res = JSON.parse(out.trim().split('\n').pop());
    assert.ok(res, 'the small corner webcam must be detected from raw faces');
    assert.strictEqual(res.quadrant, 'bottom_left');
  });

  await t.test('a large central animation alone is not a webcam', () => {
    const code = `
import sys, json
sys.path.insert(0, 'scripts')
from face_tracking import detect_streamer_webcam
records = [{'faces': [
    {'center_x': 991, 'center_y': 227, 'w': 386, 'h': 482, 'has_visible_face': True},
]} for _ in range(60)]
print(json.dumps(detect_streamer_webcam(records, 1920, 1080)))
`;
    const out = execFileSync(PY, ['-c', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(JSON.parse(out.trim().split('\n').pop()), null);
  });
});
