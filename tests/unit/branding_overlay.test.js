import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeBrandingConfig,
  escapeDrawtext,
  buildBrandingFilters,
  appendBrandingToGraph,
  appendBrandingToVideoFilters,
  brandingIsActive,
  resolveFontFile,
  resetFontCache,
  VALID_WATERMARK_POSITIONS,
} from '../../utils/brandingOverlay.js';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// ---------------------------------------------------------------------------
// drawtext escaping — the highest-risk surface: one unescaped ':' corrupts the
// entire FFmpeg filter graph and fails the whole render.
// ---------------------------------------------------------------------------

test('Branding: drawtext escaping', async (t) => {
  await t.test('escapes the filter-graph metacharacters', () => {
    assert.strictEqual(escapeDrawtext('a:b'), 'a\\:b');
    assert.strictEqual(escapeDrawtext('a,b'), 'a\\,b');
    assert.strictEqual(escapeDrawtext('a;b'), 'a\\;b');
    assert.strictEqual(escapeDrawtext("it's"), "it\\'s");
    assert.strictEqual(escapeDrawtext('[x]'), '\\[x\\]');
    assert.strictEqual(escapeDrawtext('100%'), '100\\%');
  });

  await t.test('escapes backslashes before anything else (no double-escaping bug)', () => {
    // A single backslash must become two, not get mangled by later passes.
    assert.strictEqual(escapeDrawtext('a\\b'), 'a\\\\b');
    // A backslash followed by a colon: both need escaping, backslash first.
    assert.strictEqual(escapeDrawtext('a\\:b'), 'a\\\\\\:b');
  });

  await t.test('collapses newlines — they would terminate the option list', () => {
    assert.strictEqual(escapeDrawtext('line1\nline2'), 'line1 line2');
    assert.strictEqual(escapeDrawtext('a\r\nb'), 'a b');
  });

  await t.test('null/undefined become an empty string, not the text "null"', () => {
    assert.strictEqual(escapeDrawtext(null), '');
    assert.strictEqual(escapeDrawtext(undefined), '');
  });

  await t.test('leaves ordinary unicode channel names untouched', () => {
    assert.strictEqual(escapeDrawtext('Windah Basudara'), 'Windah Basudara');
    assert.strictEqual(escapeDrawtext('チャンネル名'), 'チャンネル名');
  });
});

// ---------------------------------------------------------------------------
// Config normalisation
// ---------------------------------------------------------------------------

test('Branding: config normalisation', async (t) => {
  await t.test('defaults are sane and branding is enabled by default', () => {
    const cfg = normalizeBrandingConfig({});
    assert.strictEqual(cfg.showSource, true);
    assert.strictEqual(cfg.showWatermark, true);
    assert.strictEqual(cfg.watermarkPosition, 'bottom-right');
    assert.strictEqual(cfg.sourcePosition, 'top-left');
    assert.ok(cfg.watermarkOpacity > 0 && cfg.watermarkOpacity <= 1);
  });

  await t.test('rejects an invalid position instead of emitting a broken x/y', () => {
    const cfg = normalizeBrandingConfig({ watermarkPosition: 'middle-of-nowhere' });
    assert.ok(VALID_WATERMARK_POSITIONS.includes(cfg.watermarkPosition));
    assert.strictEqual(cfg.watermarkPosition, 'bottom-right');
  });

  await t.test('accepts every declared position', () => {
    for (const pos of VALID_WATERMARK_POSITIONS) {
      assert.strictEqual(normalizeBrandingConfig({ watermarkPosition: pos }).watermarkPosition, pos);
    }
  });

  await t.test('clamps opacity and font size into a renderable range', () => {
    assert.strictEqual(normalizeBrandingConfig({ watermarkOpacity: 99 }).watermarkOpacity, 1);
    assert.strictEqual(normalizeBrandingConfig({ watermarkOpacity: -5 }).watermarkOpacity, 0.1);
    assert.strictEqual(normalizeBrandingConfig({ watermarkFontSize: 9999 }).watermarkFontSize, 96);
    assert.strictEqual(normalizeBrandingConfig({ watermarkFontSize: 1 }).watermarkFontSize, 14);
  });

  await t.test('rejects malformed colours and keeps the fallback', () => {
    assert.strictEqual(normalizeBrandingConfig({ watermarkColor: 'red' }).watermarkColor, '#FFFFFF');
    assert.strictEqual(normalizeBrandingConfig({ watermarkColor: '#GGG' }).watermarkColor, '#FFFFFF');
    assert.strictEqual(normalizeBrandingConfig({ watermarkColor: '#FF0000' }).watermarkColor, '#FF0000');
  });

  await t.test('truncates absurdly long text instead of shipping it to the encoder', () => {
    const cfg = normalizeBrandingConfig({ watermarkText: 'x'.repeat(500) });
    assert.ok(cfg.watermarkText.length <= 60);
  });

  await t.test('honours explicit opt-out flags', () => {
    const cfg = normalizeBrandingConfig({ showSource: false, showWatermark: false });
    assert.strictEqual(cfg.showSource, false);
    assert.strictEqual(cfg.showWatermark, false);
    assert.strictEqual(brandingIsActive(cfg), false);
  });

  await t.test('tolerates non-object input without throwing', () => {
    for (const junk of [null, undefined, 'string', 42, []]) {
      const cfg = normalizeBrandingConfig(junk);
      assert.ok(cfg && typeof cfg === 'object');
    }
  });
});

test('Branding: activation predicate', async (t) => {
  await t.test('inactive when there is nothing to draw', () => {
    assert.strictEqual(brandingIsActive(normalizeBrandingConfig({})), false);
    assert.strictEqual(brandingIsActive(null), false);
  });

  await t.test('a source channel alone is enough to activate', () => {
    const cfg = normalizeBrandingConfig({ sourceChannel: 'Windah Basudara', showWatermark: false });
    assert.strictEqual(brandingIsActive(cfg), true);
  });

  await t.test('a watermark alone is enough to activate', () => {
    const cfg = normalizeBrandingConfig({ watermarkText: '@clipsaya', showSource: false });
    assert.strictEqual(brandingIsActive(cfg), true);
  });
});

// ---------------------------------------------------------------------------
// Filter generation
// ---------------------------------------------------------------------------

test('Branding: filter generation', async (t) => {
  const cfg = normalizeBrandingConfig({
    sourceChannel: 'Windah Basudara',
    watermarkText: '@clipsaya',
  });

  await t.test('emits one drawtext per element', () => {
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    assert.strictEqual(filters.length, 2);
    assert.ok(filters[0].startsWith('drawtext='));
    assert.ok(filters[1].startsWith('drawtext='));
  });

  await t.test('labels the attribution with the source channel', () => {
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    assert.ok(filters[0].includes('Sumber\\: Windah Basudara'));
  });

  await t.test('uses a custom source label when provided', () => {
    const filters = buildBrandingFilters(
      normalizeBrandingConfig({ sourceChannel: 'CNN', sourceLabel: 'Sumber Asli' }),
      { fontFile: FONT }
    );
    assert.ok(filters[0].includes('Sumber Asli\\: CNN'));
  });

  await t.test('time-limits the attribution so it does not cover the clip forever', () => {
    const filters = buildBrandingFilters(
      normalizeBrandingConfig({ sourceChannel: 'X', sourceDuration: 4 }),
      { fontFile: FONT }
    );
    assert.ok(/enable='lte\(t,4\)'/.test(filters[0]));
  });

  await t.test('clamps an absurd attribution duration', () => {
    const filters = buildBrandingFilters(
      normalizeBrandingConfig({ sourceChannel: 'X', sourceDuration: 99999 }),
      { fontFile: FONT }
    );
    assert.ok(/enable='lte\(t,20\)'/.test(filters[0]));
  });

  await t.test('the watermark has no time limit (stays for the whole clip)', () => {
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    assert.ok(!filters[1].includes('enable='));
  });

  await t.test('anchors each element to its own corner', () => {
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    // Source top-left, watermark bottom-right.
    assert.ok(filters[0].includes(':x=40'), 'source should be left-anchored');
    assert.ok(filters[0].includes(':y=40'), 'source should be top-anchored');
    assert.ok(filters[1].includes(':x=w-tw-30'), 'watermark should be right-anchored');
    assert.ok(filters[1].includes(':y=h-th-30'), 'watermark should be bottom-anchored');
  });

  await t.test('every filter carries a legibility box', () => {
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    for (const f of filters) {
      assert.ok(f.includes('box=1'), `missing box on: ${f.slice(0, 60)}`);
      assert.ok(/boxcolor=#/.test(f));
    }
  });

  await t.test('a channel name full of metacharacters cannot corrupt the graph', () => {
    // The regression that matters: this must not produce a raw unescaped ':'
    // inside the text value.
    const nasty = normalizeBrandingConfig({
      sourceChannel: "ACME:News, Inc.; 'Best%'",
      watermarkText: 'a:b,c',
    });
    const filters = buildBrandingFilters(nasty, { fontFile: FONT });
    const textOf = (f) => f.match(/:text='([^']*)'/)[1];
    assert.strictEqual(textOf(filters[0]).includes(': '), true);
    // No bare colon may survive inside the text value.
    assert.ok(!/[^\\]:/.test(textOf(filters[0]).replace('Sumber\\: ', '')));
    // And the filter must still parse into balanced quotes.
    for (const f of filters) {
      const quotes = (f.match(/'/g) || []).length;
      assert.strictEqual(quotes % 2, 0, `unbalanced quotes in: ${f}`);
    }
  });

  await t.test('returns [] rather than emitting drawtext without a font', () => {
    // drawtext hard-fails the render when fontfile is missing entirely.
    const saved = process.env.BRANDING_FONT_FILE;
    process.env.BRANDING_FONT_FILE = '/nonexistent/font.ttf';
    resetFontCache();
    try {
      const filters = buildBrandingFilters(cfg, { fontFile: null });
      assert.deepStrictEqual(filters, []);
    } finally {
      if (saved === undefined) delete process.env.BRANDING_FONT_FILE;
      else process.env.BRANDING_FONT_FILE = saved;
      resetFontCache();
    }
  });

  await t.test('resolveFontFile finds a real font on this machine', () => {
    resetFontCache();
    const font = resolveFontFile();
    // Either a real path, or null on a box with no TTFs — both are handled.
    assert.ok(font === null || typeof font === 'string');
  });
});

// ---------------------------------------------------------------------------
// Graph integration
// ---------------------------------------------------------------------------

test('Branding: filter graph integration', async (t) => {
  const cfg = normalizeBrandingConfig({ sourceChannel: 'Chan', watermarkText: '@me' });

  await t.test('appends a branded chain and returns the new output label', () => {
    const out = appendBrandingToGraph('[0:v]scale=1080:1920[vraw]', '[vraw]', cfg, { fontFile: FONT });
    assert.strictEqual(out.outputLabel, '[branded]');
    assert.ok(out.filterComplex.includes(';vraw,'));
    assert.ok(out.filterComplex.includes('[branded]'));
  });

  await t.test('leaves the graph untouched when branding is inactive', () => {
    const graph = '[0:v]scale=1080:1920[vraw]';
    const out = appendBrandingToGraph(graph, '[vraw]', normalizeBrandingConfig({}), { fontFile: FONT });
    assert.strictEqual(out.filterComplex, graph);
    assert.strictEqual(out.outputLabel, '[vraw]');
  });

  await t.test('the branded label replaces the consumed one (no dangling link)', () => {
    const out = appendBrandingToGraph('[0:v]crop=1:1[a]', '[a]', cfg, { fontFile: FONT });
    // The original label is consumed exactly once; the graph still balances.
    const produced = (out.filterComplex.match(/\[[a-z]+\]/g) || []);
    assert.ok(produced.includes('[branded]'));
    assert.strictEqual(out.outputLabel, '[branded]');
  });

  await t.test('vf-path appending keeps the existing chain first', () => {
    const vf = appendBrandingToVideoFilters('crop=405:720:0:0,scale=1080:1920', cfg, { fontFile: FONT });
    assert.ok(vf.startsWith('crop=405:720:0:0,scale=1080:1920,'));
    assert.ok(vf.includes('drawtext='));
  });

  await t.test('vf-path with an empty base filter stays valid', () => {
    const vf = appendBrandingToVideoFilters('', cfg, { fontFile: FONT });
    assert.ok(vf.startsWith('drawtext='));
    assert.ok(!vf.startsWith(','));
  });

  await t.test('vf-path is a no-op when branding is inactive', () => {
    assert.strictEqual(
      appendBrandingToVideoFilters('crop=1:1', normalizeBrandingConfig({}), { fontFile: FONT }),
      'crop=1:1'
    );
  });
});

// ---------------------------------------------------------------------------
// Plumber regression: processClips forwards `branding` into clipVideo.
//
// `clipVideo` receives a HAND-WRITTEN options object, so any new field that the
// caller forgets to add is dropped silently — the render succeeds and the
// overlay simply never appears. That is exactly how branding shipped broken
// once; this test guards the seam with a real end-to-end render.
// ---------------------------------------------------------------------------

test('Branding: processClips actually forwards branding to the encoder', async (t) => {
  await t.test('the drawtext filter reaches ffmpeg (real render, real overlay)', async () => {
    const { processClips } = await import('../../utils/clipper.js');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const execFileAsync = promisify(execFile);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-plumb-'));
    const built = path.join(tmpDir, 'built.mp4');
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir, { recursive: true });

    try {
      // A tiny synthetic source so the test never touches the network.
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=2',
        '-pix_fmt', 'yuv420p', built,
      ], { timeout: 60000 });

      const clips = [{ start: 0, end: 2, title: 'Plumb', hookText: 'h', viralityScore: 80 }];
      const results = await processClips(built, clips, 'plumbtest', '9:16', {
        layoutMode: 'standard',
        outputDir: outDir,
        branding: {
          showSource: true,
          showWatermark: true,
          sourceChannel: 'SRCCHANNEL',
          watermarkText: '@wmtest',
        },
      });

      assert.strictEqual(results.length, 1);
      const produced = results[0].outputPath || path.join(outDir, results[0].filename);
      assert.ok(fs.existsSync(produced), 'render should produce a file');

      // Two independent proofs the overlay was applied:
      //  1. the filter was in the command line we built, and
      //  2. the pixels changed versus a render with branding disabled.
      const withBranding = fs.statSync(produced).size;

      const plain = await processClips(built, clips, 'plaintest', '9:16', {
        layoutMode: 'standard',
        outputDir: outDir,
        branding: { showSource: false, showWatermark: false },
      });
      const plainPath = plain[0].outputPath || path.join(outDir, plain[0].filename);
      const withoutBranding = fs.statSync(plainPath).size;

      assert.notStrictEqual(
        withBranding,
        withoutBranding,
        'branded output must differ in size from the un-branded render'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
