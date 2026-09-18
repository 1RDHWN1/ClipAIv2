// tests/unit/adaptive_layout.test.js
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { buildGamingStreamerFilterGraph, buildStackedSplitFilterGraph } from '../../utils/clipper.js';

test('Adaptive Multi-Layout Engine (Milestone 4)', async (t) => {
  await t.test('Case 1: buildGamingStreamerFilterGraph generates valid dimensions and filter syntax', () => {
    const graph = buildGamingStreamerFilterGraph({
      srcWidth: 1920,
      srcHeight: 1080,
    });

    assert.strictEqual(graph.renderWidth, 1080);
    assert.strictEqual(graph.renderHeight, 1920);
    assert.strictEqual(graph.camHeight, 800);
    assert.strictEqual(graph.gameHeight, 1120);
    assert.ok(graph.filterComplex.includes('scale=1080:800'), 'Should scale facecam to 800px');
    assert.ok(graph.filterComplex.includes('scale=1080:1120'), 'Should scale gameplay to 1120px');
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
});
