import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readSource = (rel) => readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * The UI ships with "Auto Subtitles" checked ON. The API used to default the
 * other way (no subtitleConfig => subtitles OFF), so a client that omitted the
 * field silently got a caption-less video with no error. These tests pin the
 * two defaults together so they cannot drift apart again.
 */
test('Subtitle defaults: API must match the UI', async (t) => {
  const api = readSource('routes/api.js');

  await t.test('an absent subtitleConfig enables subtitles (not null/off)', () => {
    // The else-branch must set enabled: true — the old code left it null.
    const block = api.slice(
      api.indexOf('let cleanSubtitleConfig = null;'),
      api.indexOf('// Normalisasi parameter AI Model')
    );
    assert.ok(
      /else\s*\{[\s\S]*enabled:\s*true/.test(block),
      'the fallback branch must enable subtitles so an omitted field is not silently OFF'
    );
  });

  await t.test('an explicit false still turns subtitles off', () => {
    const block = api.slice(
      api.indexOf('let cleanSubtitleConfig = null;'),
      api.indexOf('// Normalisasi parameter AI Model')
    );
    assert.ok(
      /subtitleConfig === false[\s\S]*enabled:\s*false/.test(block),
      'explicit opt-out must be honoured'
    );
  });

  await t.test('the UI checkbox ships checked', () => {
    const ui = readSource('public/index.html');
    const match = ui.match(/<input[^>]*id="subtitlesEnabled"[^>]*>/);
    assert.ok(match, 'the subtitlesEnabled checkbox must exist');
    assert.ok(match[0].includes('checked'), 'the UI default is ON, so the API default must be ON too');
  });

  await t.test('the worker logs an unmistakable message when subtitles are off', () => {
    const worker = readSource('workers/videoWorker.js');
    assert.ok(
      /DISABLED \(video tidak akan punya takarir\)/.test(worker),
      'a caption-less render must say so loudly, because it looks like a bug otherwise'
    );
  });
});
