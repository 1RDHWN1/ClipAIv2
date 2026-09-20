import test from 'node:test';
import assert from 'node:assert';
import { buildGamingStreamerFilterGraph, GAMING_CAM_PANEL_H, GAMING_GAME_PANEL_H } from '../../utils/clipper.js';

test('Gaming Streamer Webcam Detection & Positioning', async (t) => {
  await t.test('Case 1: explicit webcam coordinates are correctly injected into crop filter', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: 832,
      camY: 396,
      camW: 448,
      camH: 324,
    });

    assert.strictEqual(graph.renderWidth, 1080);
    assert.strictEqual(graph.renderHeight, 1920);
    // Panel atas harus memotong webcam di koordinat (832, 396) dengan ukuran 448x324
    assert.ok(
      graph.filterComplex.includes('crop=448:324:832:396'),
      `Filter complex must crop webcam at (832, 396), got: ${graph.filterComplex}`
    );
    assert.ok(graph.filterComplex.includes(`scale=1080:${GAMING_CAM_PANEL_H}`), 'Cam must be scaled to 1080x480');
    assert.ok(graph.filterComplex.includes(`scale=1080:${GAMING_GAME_PANEL_H}`), 'Game panel must be 1080x1440 (blur fill)');
    assert.ok(graph.filterComplex.includes('gblur'), 'Game letterbox must be blurred, not black');
    assert.ok(graph.filterComplex.includes('vstack=inputs=2'), 'Must stack vertically');
  });

  await t.test('Case 2: default fallback centres the crop instead of a blind corner', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: undefined,
      camY: undefined,
    });

    // defaultCamW = 1280 * 0.35 = 448
    // defaultCamH = 720 * 0.45 = 324
    // defaultCamX = (1280 - 448) / 2 = 416 (centre)
    // defaultCamY = (720 - 324) / 2 = 198 (centre)
    //
    // A blind bottom-right anchor used to crop (832:396) — empty background on
    // any non-gameplay source, which is the "cropped some random corner"
    // failure. Without a detected webcam box the centre is the safe framing.
    assert.ok(
      graph.filterComplex.includes('crop=448:324:416:198'),
      `Default webcam should centre the crop (416:198), got: ${graph.filterComplex}`
    );
    assert.ok(
      !graph.filterComplex.includes('crop=448:324:832:396'),
      'Default must NOT anchor to the bottom-right corner any more'
    );
  });

  await t.test('Case 3: out-of-bound cam coordinates are clamped within source video boundaries', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1280,
      srcHeight: 720,
      camX: 2000, // beyond frame
      camY: 1500, // beyond frame
      camW: 448,
      camH: 324,
    });

    // Must clamp to max allowable (1280 - 448 = 832, 720 - 324 = 396)
    assert.ok(
      graph.filterComplex.includes('crop=448:324:832:396'),
      `OutOfBounds camX/Y must be clamped safely, got: ${graph.filterComplex}`
    );
  });

  await t.test('Case 4: detect_streamer_webcam isolates corner webcam over center gameplay NPC faces', async () => {
    const { spawnSync } = await import('node:child_process');
    const pyCode = `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam

records = []
for _ in range(15):
    records.append({'faces': [
        {'center_x': 1115, 'center_y': 605, 'w': 110, 'h': 140, 'has_visible_face': True},
        {'center_x': 640, 'center_y': 360, 'w': 180, 'h': 220, 'has_visible_face': True}
    ]})

res = detect_streamer_webcam(records, 1280, 720)
print(json.dumps(res))
`;
    const child = spawnSync('/home/cutycat15/addstorage/clipai_venv/bin/python', ['-c', pyCode], { encoding: 'utf8' });
    assert.strictEqual(child.status, 0, `Python exited with error: ${child.stderr}`);
    const res = JSON.parse(child.stdout.trim());
    assert.ok(res, 'Webcam must be detected');
    assert.strictEqual(res.quadrant, 'bottom_right');
    assert.strictEqual(res.center_x, 1115);
    assert.strictEqual(res.center_y, 605);
  });

  await t.test('Case 5: detect_streamer_webcam safely rejects pure center gameplay faces without webcam', async () => {
    const { spawnSync } = await import('node:child_process');
    const pyCode = `
import sys, json
sys.path.append('scripts')
from face_tracking import detect_streamer_webcam

records = []
for i in range(12):
    records.append({'faces': [
        {'center_x': 600 + i * 10, 'center_y': 340 + i * 5, 'w': 180, 'h': 220, 'has_visible_face': True}
    ]})

res = detect_streamer_webcam(records, 1280, 720)
print(json.dumps(res))
`;
    const child = spawnSync('/home/cutycat15/addstorage/clipai_venv/bin/python', ['-c', pyCode], { encoding: 'utf8' });
    assert.strictEqual(child.status, 0, `Python exited with error: ${child.stderr}`);
    const res = JSON.parse(child.stdout.trim());
    assert.strictEqual(res, null, 'Center-only gameplay faces must not be misclassified as webcam');
  });
});
