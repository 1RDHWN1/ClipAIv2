import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  headlineFromSpokenHook,
  headlineFromDescription,
  headlineRepeatsTitle,
} from '../../utils/metadataGenerator.js';

const PY = process.env.FACE_TRACKING_PYTHON || 'python3';

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

test('Crop safety: reaction videos are not mistaken for gaming streams', async (t) => {
  await t.test('a large face (the subject) is rejected as a corner webcam', () => {
    // face width 198/1280 = 15.5% -> the video's subject, not an overlay.
    const code = `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam
records = [{'faces':[{'center_x':273,'center_y':444,'w':198,'h':260,'has_visible_face':True}]} for _ in range(5)]
print(json.dumps(detect_streamer_webcam(records, 1280, 720)))
`;
    assert.strictEqual(runPy(code), null, 'a 15.5%-wide face must not be a webcam overlay');
  });

  await t.test('a genuine small corner webcam is still accepted', () => {
    // face width 110/1280 = 8.6% -> a real corner webcam.
    const code = `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam
records = []
for _ in range(15):
    records.append({'faces':[
        {'center_x':1115,'center_y':605,'w':110,'h':140,'has_visible_face':True},
        {'center_x':640,'center_y':360,'w':180,'h':220,'has_visible_face':True}
    ]})
print(json.dumps(detect_streamer_webcam(records, 1280, 720)))
`;
    const res = runPy(code);
    assert.ok(res, 'a small persistent corner face must still be detected');
    assert.strictEqual(res.quadrant, 'bottom_right');
    assert.ok(res.per_frame_score >= 1.8, `per_frame_score ${res.per_frame_score} must clear 1.8`);
  });

  await t.test('the per-frame score is duration-independent', () => {
    // The same webcam sampled 15x vs 45x must yield the SAME per-frame score,
    // which is why the threshold is normalised (an absolute one would reject
    // genuine short gaming clips).
    const mk = (n) => `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam
records = []
for _ in range(${n}):
    records.append({'faces':[
        {'center_x':1115,'center_y':605,'w':110,'h':140,'has_visible_face':True},
        {'center_x':640,'center_y':360,'w':180,'h':220,'has_visible_face':True}
    ]})
print(json.dumps(detect_streamer_webcam(records, 1280, 720)))
`;
    const a = runPy(mk(15));
    const b = runPy(mk(45));
    assert.ok(a && b, 'both must detect the webcam');
    assert.ok(
      Math.abs(a.per_frame_score - b.per_frame_score) < 0.05,
      `per-frame score must not drift with duration (${a.per_frame_score} vs ${b.per_frame_score})`
    );
  });

  await t.test('the clipper gates on the per-frame score, not the raw score', async () => {
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
