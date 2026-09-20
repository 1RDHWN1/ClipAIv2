import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  headlineFromSpokenHook,
  headlineFromDescription,
  headlineRepeatsTitle,
} from '../../utils/metadataGenerator.js';
import { resolveFaceTrackingPython } from '../../utils/clipper.js';

const PY = process.env.FACE_TRACKING_PYTHON || resolveFaceTrackingPython();

// ---------------------------------------------------------------------------
// Crop safety: a reaction video must NOT be treated as a gaming stream.
//
// Measured failure (iShowSpeed reaction clip): the tracker returned a
// "webcamBox" spanning 34% of the frame at score 5.18 (1.04/frame), the
// clipper switched to the two-panel gaming layout, and the crop landed on the
// animation panel instead of the person.
// ---------------------------------------------------------------------------

function runPy(code) {
  const out = execFileSync(PY, ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

test('Crop safety: a webcam overlay is told apart from a centred subject', async (t) => {
  // Ground truth measured from the real iShowSpeed source (1280x720):
  //   real webcam face  -> centre (287,456), 14% wide, hugs the left edge
  //   centred subject   -> centre (640,360), any size
  // Size does NOT separate them (14% vs 15.5% measured), position does.
  const mk = (faces, n) => `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam
records = [{'faces':${JSON.stringify(faces).replace(/true/g, 'True').replace(/false/g, 'False')}} for _ in range(${n})]
print(json.dumps(detect_streamer_webcam(records, 1280, 720)))
`;

  await t.test('a centred subject is NOT a webcam overlay, whatever its size', () => {
    for (const w of [110, 179, 198]) {
      const res = runPy(mk([{ center_x: 640, center_y: 360, w, h: 250, has_visible_face: true }], 60));
      assert.strictEqual(res, null, `a centred face (w=${w}) must not be a webcam overlay`);
    }
  });

  await t.test('the real iShowSpeed corner webcam IS detected', () => {
    const res = runPy(mk([{ center_x: 287, center_y: 456, w: 179, h: 232, has_visible_face: true }], 60));
    assert.ok(res, 'the real left-edge webcam must be detected');
    assert.strictEqual(res.quadrant, 'bottom_left');
    assert.ok(res.per_frame_score >= 0.35, `per_frame_score ${res.per_frame_score} must clear 0.35`);
  });

  await t.test('a two-person podcast (both near centre) is rejected', () => {
    const res = runPy(mk([
      { center_x: 420, center_y: 340, w: 180, h: 230, has_visible_face: true },
      { center_x: 860, center_y: 340, w: 180, h: 230, has_visible_face: true },
    ], 60));
    assert.strictEqual(res, null, 'two centred speakers must not look like a webcam overlay');
  });

  await t.test('a small corner webcam is still accepted', () => {
    const res = runPy(mk([{ center_x: 1150, center_y: 90, w: 110, h: 140, has_visible_face: true }], 60));
    assert.ok(res, 'a small persistent corner face must still be detected');
    assert.strictEqual(res.quadrant, 'top_right');
  });

  await t.test('the per-frame score is duration-independent', () => {
    const face = [{ center_x: 1150, center_y: 90, w: 110, h: 140, has_visible_face: true }];
    const a = runPy(mk(face, 15));
    const b = runPy(mk(face, 45));
    assert.ok(a && b, 'both must detect the webcam');
    assert.ok(
      Math.abs(a.per_frame_score - b.per_frame_score) < 0.05,
      `per-frame score must not drift with duration (${a.per_frame_score} vs ${b.per_frame_score})`
    );
  });

  await t.test('the clipper gates on the per-frame score', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('utils/clipper.js', 'utf-8')
    );
    assert.ok(/GAMING_WEBCAM_MIN_PER_FRAME/.test(src), 'a named per-frame threshold must exist');
    assert.ok(/per_frame_score/.test(src), 'the clipper must read per_frame_score');
    assert.ok(
      !/webcamBox\.score \|\| 0\) >= 4\.0/.test(src),
      'the old 4.0 absolute threshold must be gone'
    );
  });
});

// ---------------------------------------------------------------------------
// Headline must differ from the title, with usable fallbacks.
// ---------------------------------------------------------------------------

test('Headline fallbacks: derive a different angle when the model echoes the title', async (t) => {
  await t.test('a spoken hook is condensed into a short headline', () => {
    const title = 'Apple Sent Speed iPhone 18 For Free 🎁';
    const hook = 'Guys, I just saw a tweet that someone else received their iPhone from Apple.';
    const hl = headlineFromSpokenHook(hook, title);
    assert.ok(hl, 'must produce a headline');
    assert.ok(hl.length <= 48, `headline too long: ${hl}`);
    assert.ok(!headlineRepeatsTitle(hl, title), 'must not repeat the title');
  });

  await t.test('opening fillers are stripped BEFORE clause splitting', () => {
    // "Guys," must not survive as the whole headline (the old bug).
    const hl = headlineFromSpokenHook('Guys, this is the moment everything changed.', 'Something Else');
    assert.ok(hl && !/^guys$/i.test(hl), `must not reduce to just "Guys", got ${hl}`);
  });

  await t.test('a description yields a different-angle fallback', () => {
    const title = 'Apple Sent Speed iPhone 18 For Free 🎁';
    const desc = 'His card kept saying FAILED, so he drove to the store.';
    const hl = headlineFromDescription(desc, title);
    assert.ok(hl, 'must produce a headline from the description');
    assert.ok(!headlineRepeatsTitle(hl, title));
  });

  await t.test('both helpers return null on junk input', () => {
    for (const junk of [null, undefined, '', 42, {}]) {
      assert.strictEqual(headlineFromSpokenHook(junk, 'T'), null);
      assert.strictEqual(headlineFromDescription(junk, 'T'), null);
    }
  });
});
