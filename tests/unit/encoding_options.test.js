// tests/unit/encoding_options.test.js
import test from 'node:test';
import assert from 'node:assert';

import { buildVideoEncodingOptions } from '../../utils/clipper.js';

/**
 * Regression: x264 rate-control conflict (audit finding H1).
 *
 * ORIGINAL DEFECT
 * ---------------
 * The ffmpeg command passed BOTH `-b:v 2000k` (via `fluent-ffmpeg`'s
 * `.videoBitrate()`) and `-crf 23`, with `-crf` AFTER `-preset veryfast`:
 *
 *   -vcodec libx264 -b:v 2000k -preset veryfast -crf 23 -movflags +faststart
 *
 * In x264, a CRF target supersedes the bitrate target. So the bitrate was
 * decorative and the real quality was CRF 23 — blocky for a 1080x1920 canvas
 * where burned-in subtitles and grain are plainly visible. Verified by render:
 * a 5s testsrc2 clip encoded with the old flags produced ~5.47 Mbps, while the
 * intended CRF 19 / preset medium produced ~9.11 Mbps.
 *
 * INVARIANT
 * ---------
 * Exactly ONE rate-control mode may ever be emitted: `-crf` OR bitrate flags,
 * never both. Mixing them silently reintroduces the defect.
 */

function extract(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

test('Encoding: x264 options never mix CRF and bitrate (H1)', async (t) => {
  await t.test('Case 1: default mode is CRF 19 with preset medium', () => {
    const args = buildVideoEncodingOptions();
    assert.strictEqual(extract(args, '-crf'), '19');
    assert.strictEqual(extract(args, '-preset'), 'medium');
  });

  await t.test('Case 2: CRF mode never emits a bitrate target', () => {
    const args = buildVideoEncodingOptions();
    assert.strictEqual(args.includes('-b:v'), false, '-b:v must be absent in CRF mode');
    assert.strictEqual(args.includes('-maxrate'), false, '-maxrate must be absent in CRF mode');
    assert.strictEqual(args.includes('-bufsize'), false, '-bufsize must be absent in CRF mode');
  });

  await t.test('Case 3: bitrate mode never emits -crf', () => {
    const args = buildVideoEncodingOptions({ mode: 'bitrate' });
    assert.strictEqual(args.includes('-crf'), false, '-crf must be absent in bitrate mode');
    assert.strictEqual(extract(args, '-b:v'), '8000k');
    assert.strictEqual(extract(args, '-maxrate'), '10000k');
    assert.strictEqual(extract(args, '-bufsize'), '12000k');
  });

  await t.test('Case 4: streaming + compatibility flags always present', () => {
    for (const args of [buildVideoEncodingOptions(), buildVideoEncodingOptions({ mode: 'bitrate' })]) {
      assert.strictEqual(extract(args, '-movflags'), '+faststart', 'mp4 must be faststart for web');
      assert.strictEqual(extract(args, '-pix_fmt'), 'yuv420p', 'must stay broadly compatible');
    }
  });

  await t.test('Case 5: exactly one rate-control flag group is present', () => {
    const crfArgs = buildVideoEncodingOptions();
    const rateArgs = buildVideoEncodingOptions({ mode: 'bitrate' });
    const hasCrf = (a) => a.includes('-crf');
    const hasRate = (a) => a.includes('-b:v');

    assert.strictEqual(hasCrf(crfArgs) !== hasRate(crfArgs), true, 'CRF args: exactly one mode');
    assert.strictEqual(hasCrf(rateArgs) !== hasRate(rateArgs), true, 'rate args: exactly one mode');
  });

  await t.test('Case 6: overrides are honoured without breaking exclusivity', () => {
    const args = buildVideoEncodingOptions({ crf: 16, preset: 'slow' });
    assert.strictEqual(extract(args, '-crf'), '16');
    assert.strictEqual(extract(args, '-preset'), 'slow');
    assert.strictEqual(args.includes('-b:v'), false);

    const zeroCrf = buildVideoEncodingOptions({ crf: 0 }); // falsy: must still emit "0"
    assert.strictEqual(extract(zeroCrf, '-crf'), '0', 'crf=0 must not be swallowed by falsy check');
  });

  await t.test('Case 7: no duplicate output options (which ffmpeg would resolve unpredictably)', () => {
    const args = buildVideoEncodingOptions();
    for (const flag of ['-crf', '-preset', '-movflags', '-pix_fmt']) {
      const occurrences = args.filter((a) => a === flag).length;
      assert.ok(occurrences <= 1, `${flag} appears ${occurrences} times`);
    }
  });
});
