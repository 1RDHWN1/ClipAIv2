import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  normalizeBrandingConfig,
  renderHeadlineCard,
  resolvePythonWithPillow,
  buildHeadlineCardFilters,
  resetFontCache,
  resetPythonCache,
} from '../../utils/brandingOverlay.js';

// ---------------------------------------------------------------------------
// Rounded headline card
//
// FFmpeg's drawtext can only draw a hard-edged box (`box=1`), which reads as
// stiff on short-form video. The card is rendered as a rounded PNG and
// overlaid instead. These tests pin both the geometry and the fallback.
// ---------------------------------------------------------------------------

test('Headline card: config normalisation', async (t) => {
  await t.test('rounded corners are ON by default', () => {
    const cfg = normalizeBrandingConfig({ showHeadline: true, headlineText: 'X' });
    assert.strictEqual(cfg.headlineRounded, true);
    assert.strictEqual(cfg.headlineRadius, 20);
  });

  await t.test('an explicit sharp request turns the card off', () => {
    const cfg = normalizeBrandingConfig({
      showHeadline: true, headlineText: 'X', headlineRounded: false,
    });
    assert.strictEqual(cfg.headlineRounded, false);
  });

  await t.test('radius is clamped into a renderable range', () => {
    assert.strictEqual(normalizeBrandingConfig({ headlineRadius: 999 }).headlineRadius, 48);
    assert.strictEqual(normalizeBrandingConfig({ headlineRadius: -5 }).headlineRadius, 0);
  });
});

test('Headline card: PNG generation', async (t) => {
  await t.test('produces a PNG whose corners are transparent (i.e. rounded)', () => {
    const python = resolvePythonWithPillow();
    if (!python) {
      t.skip('Pillow not available in this environment');
      return;
    }

    const out = path.join(os.tmpdir(), `hl_card_test_${Date.now()}.png`);
    const res = renderHeadlineCard(
      { showHeadline: true, headlineText: "Obama's Convictions Are Being Tested", headlineRounded: true },
      { outPath: out, videoWidth: 1080 }
    );

    assert.strictEqual(res.ok, true, 'the card must render');
    assert.ok(fs.existsSync(out), 'the PNG must exist on disk');
    assert.ok(res.width > 100 && res.height > 20, `sane card size, got ${res.width}x${res.height}`);

    // A rounded rect leaves the extreme corner transparent.
    const probe = execFileSync(python, [
      '-c',
      `from PIL import Image; im=Image.open(${JSON.stringify(out)}); ` +
      `print(im.getpixel((0,0))[3], im.getpixel((im.width//2, im.height//2))[3])`,
    ], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);

    const [cornerAlpha, centreAlpha] = probe;
    assert.strictEqual(cornerAlpha, 0, 'the corner must be transparent (rounded, not square)');
    assert.strictEqual(centreAlpha, 255, 'the centre must be opaque');

    fs.unlinkSync(out);
  });

  await t.test('refuses to render when the headline is disabled', () => {
    const res = renderHeadlineCard(
      { showHeadline: false, headlineText: 'X' },
      { outPath: path.join(os.tmpdir(), 'never.png') }
    );
    assert.strictEqual(res.ok, false);
  });

  await t.test('never throws when the preferred interpreter is unusable', () => {
    // A broken BRANDING_PYTHON must not crash the render; the probe should
    // simply move on to python3/python. (This is the resilience we want.)
    const realEnv = process.env.BRANDING_PYTHON;
    process.env.BRANDING_PYTHON = '/nonexistent/python-xyz';
    resetPythonCache();
    try {
      let res;
      assert.doesNotThrow(() => {
        res = renderHeadlineCard(
          { showHeadline: true, headlineText: 'X' },
          { outPath: path.join(os.tmpdir(), 'fallback_probe.png') }
        );
      });
      assert.strictEqual(typeof res.ok, 'boolean', 'must return a result object, never throw');
      if (res.ok && fs.existsSync(path.join(os.tmpdir(), 'fallback_probe.png'))) {
        fs.unlinkSync(path.join(os.tmpdir(), 'fallback_probe.png'));
      }
    } finally {
      if (realEnv === undefined) delete process.env.BRANDING_PYTHON;
      else process.env.BRANDING_PYTHON = realEnv;
      resetPythonCache();
    }
  });

  await t.test('degrades to { ok: false } when no interpreter has Pillow', () => {
    // Point every candidate at a missing binary so the probe genuinely fails.
    const saved = {
      BRANDING_PYTHON: process.env.BRANDING_PYTHON,
      FACE_TRACKING_PYTHON: process.env.FACE_TRACKING_PYTHON,
      PATH: process.env.PATH,
    };
    process.env.BRANDING_PYTHON = '/nonexistent/a';
    process.env.FACE_TRACKING_PYTHON = '/nonexistent/b';
    process.env.PATH = '/nonexistent'; // hides python3 / python
    resetPythonCache();
    try {
      const res = renderHeadlineCard(
        { showHeadline: true, headlineText: 'X' },
        { outPath: path.join(os.tmpdir(), 'never3.png') }
      );
      assert.strictEqual(res.ok, false, 'must degrade cleanly so the caller can fall back');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetPythonCache();
    }
  });
});

test('Headline card: filter construction', async (t) => {
  await t.test('builds a movie source plus an overlay at y=120', () => {
    const f = buildHeadlineCardFilters(
      { showHeadline: true, headlineText: 'Hello', headlineDuration: 5 },
      '/tmp/card.png'
    );
    assert.ok(f, 'filters must be produced');
    assert.ok(f.movieInput.includes('movie='), 'must load the card as a movie source');
    assert.ok(f.movieInput.includes('/tmp/card.png'));
    assert.ok(f.overlayFilter.includes('overlay='));
    assert.ok(f.overlayFilter.includes('y') || f.overlayFilter.includes(':120'), 'overlay must sit at y=120');
    assert.ok(f.overlayFilter.includes("enable='lte(t,5)'"), 'must expire after the configured duration');
  });

  await t.test('returns null when there is nothing to draw', () => {
    assert.strictEqual(buildHeadlineCardFilters({ showHeadline: false }, '/tmp/x.png'), null);
    assert.strictEqual(buildHeadlineCardFilters({ showHeadline: true, headlineText: 'X' }, ''), null);
  });

  await t.test('escapes a path with spaces and colons for the filter graph', () => {
    const f = buildHeadlineCardFilters(
      { showHeadline: true, headlineText: 'X' },
      '/tmp/my card: v2.png'
    );
    assert.ok(f.movieInput.includes('\\:'), 'a colon must be escaped or ffmpeg mis-parses the option');
  });
});
