import test from 'node:test';
import assert from 'node:assert';
import { detectHardwareAcceleration, getHardwareAccelerationConfig } from '../../utils/gpuDetector.js';
import { buildVideoEncodingOptions } from '../../utils/clipper.js';

test('Hardware Acceleration & GPU Encoding Suite', async (t) => {
  await t.test('Case 1: detectHardwareAcceleration detects Linux VAAPI device when present', () => {
    const info = detectHardwareAcceleration();
    assert.strictEqual(typeof info.supported, 'boolean');
    assert.strictEqual(typeof info.name, 'string');
    if (info.supported) {
      assert.strictEqual(info.type, 'vaapi');
      assert.ok(info.device.startsWith('/dev/dri/renderD'));
      assert.strictEqual(info.encoder, 'h264_vaapi');
    }
  });

  await t.test('Case 2: getHardwareAccelerationConfig forces CPU when requested', () => {
    const cpuConfig = getHardwareAccelerationConfig({ hwaccel: 'cpu' });
    assert.strictEqual(cpuConfig.enabled, false);
    assert.strictEqual(cpuConfig.encoder, 'libx264');
    assert.strictEqual(cpuConfig.name, 'CPU Software (libx264)');
  });

  await t.test('Case 3: buildVideoEncodingOptions with hwaccel: true emits tuned CQP flags', () => {
    const flags = buildVideoEncodingOptions({ hwaccel: true, qp: 18 });
    assert.ok(flags.includes('-c:v'), 'Must have -c:v');
    assert.strictEqual(flags[flags.indexOf('-c:v') + 1], 'h264_vaapi');
    assert.ok(flags.includes('-rc_mode'), 'Must have -rc_mode');
    assert.strictEqual(flags[flags.indexOf('-rc_mode') + 1], 'CQP');
    assert.ok(flags.includes('-qp'), 'Must have -qp');
    assert.strictEqual(flags[flags.indexOf('-qp') + 1], '18');
    assert.ok(flags.includes('-profile:v'), 'Must have -profile:v');
    assert.strictEqual(flags[flags.indexOf('-profile:v') + 1], 'high');
    assert.ok(flags.includes('-coder'), 'Must have -coder');
    assert.strictEqual(flags[flags.indexOf('-coder') + 1], 'cabac');

    // Never mix with CPU flags
    assert.strictEqual(flags.includes('-crf'), false, 'GPU flags must not contain -crf');
    assert.strictEqual(flags.includes('-preset'), false, 'GPU flags must not contain -preset');
  });

  await t.test('Case 4: buildVideoEncodingOptions without hwaccel still defaults cleanly to CPU libx264 CRF 19', () => {
    const flags = buildVideoEncodingOptions();
    assert.strictEqual(flags.includes('-crf'), true, 'CPU flags must contain -crf');
    assert.strictEqual(flags[flags.indexOf('-crf') + 1], '19');
    assert.strictEqual(flags.includes('-preset'), true, 'CPU flags must contain -preset');
    assert.strictEqual(flags[flags.indexOf('-preset') + 1], 'medium');
  });
});
