import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeBrandingConfig,
  buildBrandingFilters,
  brandingIsActive,
} from '../../utils/brandingOverlay.js';
import {
  normalizeClipMetadata,
  applyMetadataToClips,
} from '../../utils/metadataGenerator.js';

test('Auto Headline: branding configuration & drawtext overlay', async (t) => {
  await t.test('headline options are normalized with safe defaults', () => {
    const cfg = normalizeBrandingConfig({
      showHeadline: true,
      headlineText: 'Kafir: Dari Gelar ke Aksi Biadab',
      headlineDuration: 5,
    });

    assert.strictEqual(cfg.showHeadline, true);
    assert.strictEqual(cfg.headlineText, 'Kafir: Dari Gelar ke Aksi Biadab');
    assert.strictEqual(cfg.headlineDuration, 5);
    assert.strictEqual(cfg.headlineColor, '#000000');
    assert.strictEqual(cfg.headlineBgColor, '#FFFFFF');
    assert.strictEqual(brandingIsActive(cfg), true);
  });

  await t.test('buildBrandingFilters produces a prominent on-screen box at y=160', () => {
    const cfg = normalizeBrandingConfig({
      showHeadline: true,
      headlineText: 'Kafir: Dari Gelar ke Aksi Biadab',
      headlineDuration: 5,
      showSource: false,
      showWatermark: false,
    });

    const filters = buildBrandingFilters(cfg, {
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    });

    assert.strictEqual(filters.length, 1);
    const f = filters[0];
    assert.ok(f.includes("text='Kafir\\: Dari Gelar ke Aksi Biadab'"));
    assert.ok(f.includes('box=1:boxcolor=#FFFFFF@0.95'));
    assert.ok(f.includes('x=(w-text_w)/2'));
    assert.ok(f.includes('y=160'));
    assert.ok(f.includes("enable='lte(t,5)'"));
  });

  await t.test('disabled headline generates no headline filter', () => {
    const cfg = normalizeBrandingConfig({
      showHeadline: false,
      headlineText: 'Kafir: Dari Gelar ke Aksi Biadab',
      showSource: false,
      showWatermark: false,
    });

    const filters = buildBrandingFilters(cfg, {
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    });

    assert.strictEqual(filters.length, 0);
  });
});

test('Auto Headline & Virality Metadata: normalization and clip merge', async (t) => {
  await t.test('normalizes headline, viralityScore and 4-pillar scoreBreakdown', () => {
    const raw = {
      headline: 'Dehumanisasi: Ancaman Nyata',
      title: 'Menyelami Makna Dehumanisasi',
      viralityScore: 99,
      scoreBreakdown: {
        hook: 'A',
        flow: 'A',
        value: 'A',
        trend: 'A-',
      },
      description: 'Penyalahgunaan istilah sering berujung kekerasan.',
      hashtags: ['#viral', '#podcast'],
      caption: 'Simak poin penting ini.',
    };

    const norm = normalizeClipMetadata(raw);
    assert.strictEqual(norm.headline, 'Dehumanisasi: Ancaman Nyata');
    assert.strictEqual(norm.title, 'Menyelami Makna Dehumanisasi');
    assert.strictEqual(norm.viralityScore, 99);
    assert.deepStrictEqual(norm.scoreBreakdown, {
      hook: 'A',
      flow: 'A',
      value: 'A',
      trend: 'A-',
    });
  });

  await t.test('applyMetadataToClips propagates headline and scores onto clip objects', () => {
    const clips = [
      { clipIndex: 1, title: 'Original 1', hookText: 'Hook 1' },
      { clipIndex: 2, title: 'Original 2', hookText: 'Hook 2' },
    ];

    const metaMap = new Map([
      [
        1,
        {
          headline: 'Headline 1',
          title: 'Title 1',
          viralityScore: 98,
          scoreBreakdown: { hook: 'A', flow: 'A', value: 'A', trend: 'A' },
          description: 'Context 1',
        },
      ],
    ]);

    const res = applyMetadataToClips(clips, metaMap);
    assert.strictEqual(res[0].headline, 'Headline 1');
    assert.strictEqual(res[0].score, 98);
    assert.strictEqual(res[0].scoreBreakdown.hook, 'A');

    // Second clip falls back gracefully
    assert.strictEqual(res[1].headline, 'Hook 2');
    assert.strictEqual(res[1].score, 95);
  });
});
