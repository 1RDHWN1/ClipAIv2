// tests/unit/adaptive_layout.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { buildGamingStreamerFilterGraph, buildStackedSplitFilterGraph, buildAdaptiveSplitFilterGraph, resolveLayoutMode } from '../../utils/clipper.js';

test('Adaptive Multi-Layout Engine (Milestone 4)', async (t) => {
  await t.test('Case 1: buildGamingStreamerFilterGraph generates valid dimensions and filter syntax', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
    });

    assert.strictEqual(graph.renderWidth, 1080);
    assert.strictEqual(graph.renderHeight, 1920);
    assert.strictEqual(graph.camHeight, 480);
    assert.strictEqual(graph.gameHeight, 1440);
    assert.ok(graph.filterComplex.includes('scale=1080:480'), 'Should scale facecam to 480px');
    assert.ok(graph.filterComplex.includes('scale=1080:1440'), 'Should fill gameplay panel at 1440px');
    assert.ok(graph.filterComplex.includes('gblur'), 'Gameplay letterbox must be filled with a blurred copy, not black bars');
    assert.ok(graph.filterComplex.includes('vstack=inputs=2'), 'Should stack cam and game vertically');
  });

  await t.test('Case 2: buildGamingStreamerFilterGraph handles custom cam coordinates and subtitle overlay', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      camX: 100,
      camY: 50,
      camW: 400,
      camH: 300,
      subtitleAssPath: 'test_subs.ass',
    });

    assert.ok(graph.filterComplex.includes('crop=400:300:100:50'), 'Should crop custom cam coordinates');
    assert.ok(graph.filterComplex.includes("ass='test_subs.ass'"), 'Should include ASS subtitle filter');
  });

  await t.test('Case 3: buildGamingStreamerFilterGraph compiles and renders cleanly via FFmpeg', async () => {
    const videoPath = path.resolve('tests/fixtures/media/sample_dialogue_1080p.mp4');
    assert.ok(fs.existsSync(videoPath), 'Fixture must exist');

    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
    });

    const outputPath = path.resolve('tests/fixtures/media/temp_gaming_test.mp4');

    const result = await new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-ss', '0',
        '-t', '1',
        '-i', videoPath,
        '-filter_complex', graph.filterComplex,
        '-map', graph.outputMap,
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

    assert.strictEqual(result.code, 0, `FFmpeg execution must succeed, err: ${result.err}`);
  });

  await t.test('Case 4: buildStackedSplitFilterGraph compiles and renders cleanly via FFmpeg', async () => {
    const videoPath = path.resolve('tests/fixtures/media/sample_dialogue_1080p.mp4');
    assert.ok(fs.existsSync(videoPath), 'Fixture must exist');

    const graph = buildStackedSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
    });

    const outputPath = path.resolve('tests/fixtures/media/temp_split_test.mp4');

    const result = await new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-ss', '0',
        '-t', '1',
        '-i', videoPath,
        '-filter_complex', graph.filterComplex,
        '-map', graph.outputMap,
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

    assert.strictEqual(result.code, 0, `FFmpeg execution must succeed, err: ${result.err}`);
  });

  await t.test('Case 5: buildAdaptiveSplitFilterGraph with empty wideIntervals produces pure solo crop without vstack', () => {
    const graph = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      wideIntervals: [],
      subtitleAssPath: 'test_subs.ass',
    });

    assert.ok(graph.filterComplex.includes('crop='), 'Must contain crop');
    assert.ok(graph.filterComplex.includes('scale=1080:1920'), 'Must scale to 1080:1920');
    assert.ok(graph.filterComplex.includes('setsar=1'), 'Must include setsar=1');
    assert.strictEqual(graph.filterComplex.includes('vstack'), false, 'Must NOT stack panels when no wide shots');
    assert.strictEqual(graph.filterComplex.includes('[top]'), false, 'Must NOT create [top] panel');
    assert.strictEqual(graph.filterComplex.includes('[bottom]'), false, 'Must NOT create [bottom] panel');
    assert.ok(graph.filterComplex.includes("ass='test_subs.ass'"), 'Must overlay subtitles on solo crop');
  });

  await t.test('Case 6: buildAdaptiveSplitFilterGraph with wideIntervals enables split overlay only on intervals', () => {
    const graph = buildAdaptiveSplitFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
      wideIntervals: [{ start: 5.0, end: 12.5, x1: 400, x2: 1500 }],
      subtitleAssPath: 'test_subs.ass',
    });

    assert.ok(graph.filterComplex.includes('vstack=inputs=2'), 'Must stack during wide interval');
    assert.ok(graph.filterComplex.includes("overlay=0:0:enable='between(t\\,5.00\\,12.50)'"), 'Must overlay only during wide interval');
    assert.ok(graph.filterComplex.includes("ass='test_subs.ass'"), 'Must include subtitles');
  });

  await t.test('Case 7: auto_split transitions to gaming_streamer when persistent webcam is detected', async () => {
    // Delegates to the real resolver instead of re-implementing the rule, so the
    // test cannot drift from production behaviour.
    const webcamBox = {
      x: 843,
      y: 396,
      width: 437,
      height: 324,
      quadrant: 'bottom_right',
      per_frame_score: 2.86,
      detections: 15,
    };

    const r = resolveLayoutMode('auto_split', webcamBox);
    assert.strictEqual(r.layoutMode, 'gaming_streamer', 'Must transition to gaming_streamer');
    assert.strictEqual(r.webcamIsUsable, true);
  });
});
