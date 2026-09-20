import test from 'node:test';
import assert from 'node:assert';
import {
  SUBTITLE_SAFE_MARGIN_V,
  VIRAL_PRESETS,
  generateAssSubtitles,
} from '../../utils/subtitleGenerator.js';
import {
  buildBrandingFilters,
  normalizeBrandingConfig,
} from '../../utils/brandingOverlay.js';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// YouTube Shorts / TikTok / Reels each draw their own UI over the bottom of the
// frame: video title, channel handle, "x hours ago", and the comment box. On a
// 1080x1920 frame that furniture starts about 463px up from the bottom edge
// (measured from a real Shorts screenshot: the title band began at 75.9% of the
// frame height). Captions placed below that line are unreadable on the real
// app, which is exactly what the user reported.
const PLATFORM_UI_ZONE_PX = 463;

test('Safe zone: captions clear the platform UI', async (t) => {
  await t.test('every preset uses the safe margin, not the old 300/240', () => {
    for (const [key, preset] of Object.entries(VIRAL_PRESETS)) {
      assert.strictEqual(
        preset.marginV,
        SUBTITLE_SAFE_MARGIN_V,
        `preset "${key}" must use the safe margin (got ${preset.marginV})`
      );
    }
  });

  await t.test('the safe margin clears the platform UI zone', () => {
    // y grows downward. The caption's bottom edge sits at y = 1920 - marginV.
    // The UI zone occupies the bottom PLATFORM_UI_ZONE_PX, i.e. it starts at
    // y = 1920 - PLATFORM_UI_ZONE_PX. The caption is clear only when its bottom
    // edge is ABOVE the UI start, i.e. a SMALLER y:
    //
    //   captionBottomY < uiTopY
    //
    // 1920 - 560 = 1360  <  1920 - 463 = 1457  ->  clear.
    const captionBottomY = 1920 - SUBTITLE_SAFE_MARGIN_V;
    const uiTopY = 1920 - PLATFORM_UI_ZONE_PX;
    assert.ok(
      captionBottomY < uiTopY,
      `caption bottom (y=${captionBottomY}) must be ABOVE the UI top (y=${uiTopY})`
    );
    // And the margin must exceed the UI zone for that to hold.
    assert.ok(
      SUBTITLE_SAFE_MARGIN_V > PLATFORM_UI_ZONE_PX,
      `safe margin (${SUBTITLE_SAFE_MARGIN_V}) must exceed the UI zone (${PLATFORM_UI_ZONE_PX})`
    );
  });

  await t.test('the generated ASS style carries the safe margin', () => {
    const words = [];
    for (let i = 0; i < 30; i++) words.push({ word: `W${i}`, start: i * 0.3, end: i * 0.3 + 0.25 });
    const ass = String(generateAssSubtitles(words, 0, 10, { preset: 'hormozi', position: 'bottom' }));
    const style = ass.split('\n').find((l) => l.startsWith('Style:'));
    assert.ok(style, 'a Style line must be emitted');
    assert.strictEqual(style.split(',')[21], String(SUBTITLE_SAFE_MARGIN_V));
  });

  await t.test('an explicit marginV is still honoured (user override wins)', () => {
    const words = [{ word: 'A', start: 0, end: 0.3 }];
    const ass = String(generateAssSubtitles(words, 0, 2, { preset: 'hormozi', marginV: 400 }));
    const style = ass.split('\n').find((l) => l.startsWith('Style:'));
    assert.strictEqual(style.split(',')[21], '400');
  });
});

test('Safe zone: the watermark clears the captions', async (t) => {
  await t.test('above-subtitles stacks on top of the safe margin', () => {
    const cfg = normalizeBrandingConfig({
      watermarkText: '@prime.clipsmedia',
      watermarkPosition: 'above-subtitles',
    });
    const f = buildBrandingFilters(cfg, { fontFile: FONT })[0];
    // safe margin + caption band (200) + gap (90)
    const expected = SUBTITLE_SAFE_MARGIN_V + 200 + 90;
    assert.ok(f.includes(`y=h-th-${expected}`), `watermark must clear the caption band, got: ${f}`);
  });

  await t.test('the watermark sits strictly above the caption band', () => {
    const watermarkBottom = 1920 - (SUBTITLE_SAFE_MARGIN_V + 200 + 90);
    const captionTop = 1920 - (SUBTITLE_SAFE_MARGIN_V + 200); // 1200
    assert.ok(
      watermarkBottom < captionTop,
      `watermark bottom (y=${watermarkBottom}) must be above the caption top (y=${captionTop})`
    );
  });
});
