import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIRAL_PRESETS,
  getPreset,
  hexToAssColor,
  formatAssTime,
  chunkWords,
  sanitizeAssFontName,
  generateAssSubtitles,
  formatFfmpegSubFilter,
} from '../../utils/subtitleGenerator.js';

describe('Subtitle Generator Engine (R2 & R3)', () => {
  describe('Color and Time Conversions', () => {
    it('converts standard hex to ASS BBGGRR color format', () => {
      // Pure White: #FFFFFF -> &H00FFFFFF&
      assert.equal(hexToAssColor('#FFFFFF'), '&H00FFFFFF&');

      // Hormozi Yellow: #FFE600 (R=FF, G=E6, B=00) -> &H0000E6FF&
      assert.equal(hexToAssColor('#FFE600'), '&H0000E6FF&');

      // MrBeast Green: #00FF66 (R=00, G=FF, B=66) -> &H0066FF00&
      assert.equal(hexToAssColor('#00FF66'), '&H0066FF00&');

      // Cyber Cyan: #00E5FF (R=00, G=E5, B=FF) -> &H00FFE500&
      assert.equal(hexToAssColor('#00E5FF'), '&H00FFE500&');

      // Handles alpha opacity
      assert.equal(hexToAssColor('#000000', '80'), '&H80000000&');
    });

    it('formats timestamps into valid ASS H:MM:SS.cc format', () => {
      assert.equal(formatAssTime(0), '0:00:00.00');
      assert.equal(formatAssTime(1.25), '0:00:01.25');
      assert.equal(formatAssTime(65.5), '0:01:05.50');
      assert.equal(formatAssTime(3661.12), '1:01:01.12');
    });
  });

  describe('Word Chunking for Short-Form Pacing', () => {
    const sampleWords = [
      { word: 'This', start: 10.0, end: 10.2 },
      { word: 'is', start: 10.25, end: 10.4 },
      { word: 'completely', start: 10.45, end: 10.9 },
      { word: 'insane.', start: 10.95, end: 11.3 },
      { word: 'Look', start: 12.0, end: 12.3 }, // >300ms pause after 11.3s
      { word: 'at', start: 12.35, end: 12.5 },
      { word: 'this!', start: 12.55, end: 12.9 },
    ];

    it('groups words into 2-4 punchy words per frame with relative timestamps', () => {
      const chunks = chunkWords(sampleWords, 10.0, 15.0, { maxWordsPerChunk: 3 });
      assert.ok(chunks.length >= 2);

      // Verify relative timestamps (10.0s -> 0.0s)
      assert.equal(chunks[0][0].word, 'This');
      assert.equal(chunks[0][0].start, 0.0);

      // Check max words per chunk boundary
      for (const chunk of chunks) {
        assert.ok(chunk.length >= 1 && chunk.length <= 4);
      }
    });

    it('splits on long speech pauses (>300ms)', () => {
      const chunks = chunkWords(sampleWords, 10.0, 15.0);
      const firstChunkWords = chunks[0].map((w) => w.word);
      assert.ok(firstChunkWords.includes('This'));
      // 'Look' must be in a subsequent chunk due to the 700ms gap
      assert.ok(!firstChunkWords.includes('Look'));
    });

    it('returns empty array when words are empty or outside clip range', () => {
      assert.deepEqual(chunkWords([], 0, 10), []);
      assert.deepEqual(chunkWords(sampleWords, 20.0, 30.0), []);
    });
  });

  describe('ASS Subtitle Script Generation', () => {
    const clipWords = [
      { word: 'Cristiano', start: 1.0, end: 1.5 },
      { word: 'Ronaldo', start: 1.55, end: 2.0 },
      { word: 'is', start: 2.05, end: 2.3 },
      { word: 'here!', start: 2.35, end: 2.8 },
    ];

    it('generates valid ASS script header scaled for 1080x1920', () => {
      const script = generateAssSubtitles(clipWords, 1.0, 3.0, { preset: 'hormozi' });
      assert.ok(script.includes('[Script Info]'));
      assert.ok(script.includes('PlayResX: 1080'));
      assert.ok(script.includes('PlayResY: 1920'));
      assert.ok(script.includes('[V4+ Styles]'));
      assert.ok(script.includes('[Events]'));
    });

    it('embeds active word illumination tags (karaoke highlight style)', () => {
      const script = generateAssSubtitles(clipWords, 1.0, 3.0, {
        preset: 'hormozi',
        highlightColor: '#FFE600',
        primaryColor: '#FFFFFF',
      });

      // Contains Dialogue event
      assert.ok(script.includes('Dialogue: 0,'));

      // Contains ASS color override tag for active word highlight
      assert.ok(script.includes('{\\c&H0000E6FF&}'));

      // Contains ASS color override reset to primary color
      assert.ok(script.includes('{\\c&H00FFFFFF&}'));
    });

    it('supports all 4 viral presets', () => {
      for (const presetKey of ['hormozi', 'mrbeast', 'cyber', 'minimal']) {
        const script = generateAssSubtitles(clipWords, 1.0, 3.0, { preset: presetKey });
        const preset = VIRAL_PRESETS[presetKey];
        assert.ok(script.length > 100);
        assert.ok(script.includes(preset.fontFamily.split(',')[0]));
      }
    });

    it('supports custom vertical position overrides (bottom, center, top)', () => {
      const bottomScript = generateAssSubtitles(clipWords, 1.0, 3.0, { position: 'bottom' });
      assert.ok(bottomScript.includes(',2,40,40,')); // Alignment 2 = bottom-center

      const centerScript = generateAssSubtitles(clipWords, 1.0, 3.0, { position: 'center' });
      assert.ok(centerScript.includes(',5,40,40,')); // Alignment 5 = center

      const topScript = generateAssSubtitles(clipWords, 1.0, 3.0, { position: 'top' });
      assert.ok(topScript.includes(',8,40,40,')); // Alignment 8 = top-center
    });
  });

  describe('FFmpeg Filter Formatting', () => {
    it('escapes Windows backslashes and colons safely for FFmpeg ass filter', () => {
      const winPath = 'C:\\Users\\eniku\\outputs\\job1_subs.ass';
      const filter = formatFfmpegSubFilter(winPath);
      assert.ok(filter.startsWith("ass='"));
      assert.ok(filter.endsWith("'"));
      assert.ok(filter.includes('C\\:/Users/eniku/outputs/job1_subs.ass'));
      assert.ok(!filter.includes('\\Users'));
    });
  });
});

describe('Caption Continuity (regression)', () => {
  it('holds captions across short auto-sub gaps instead of blanking', () => {
    // Bug: auto-generated transcripts (YouTube subs) have short 1-2s gaps
    // between sentences. The old renderer ended each caption exactly at the
    // last spoken word, blanking the screen during those gaps so subtitles
    // looked "missing". Captions must hold across SHORT gaps.
    const clipStart = 100;
    const clipEnd = 215;
    const words = [];
    let t = 95;
    for (let i = 0; i < 200; i++) {
      const dur = 0.4 + ((i * 37) % 30) / 100; // deterministic pseudo-random
      words.push({ word: `w${i}`, start: t, end: t + dur });
      t += dur + (i % 3 === 0 ? 1.8 : 0.05);
      if (t > 220) break;
    }

    const ass = generateAssSubtitles(words, clipStart, clipEnd, { preset: 'cyber' });
    const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.ok(lines.length > 0, 'Must produce subtitle events');

    const toSec = (ts) => {
      const [h, m, s] = ts.split(':');
      return Number(h) * 3600 + Number(m) * 60 + parseFloat(s);
    };

    const intervals = lines
      .map((l) => {
        const p = l.split(',');
        return { s: toSec(p[1]), e: toSec(p[2]) };
      })
      .sort((a, b) => a.s - b.s);

    const merged = [];
    for (const iv of intervals) {
      if (!merged.length || iv.s > merged[merged.length - 1].e) merged.push({ ...iv });
      else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, iv.e);
    }

    const clipDuration = clipEnd - clipStart;
    const covered = merged.reduce((acc, m) => acc + Math.max(0, m.e - m.s), 0);
    const coverageRatio = covered / clipDuration;

    assert.ok(
      coverageRatio >= 0.95,
      `Caption coverage must be >= 95% of the clip (got ${(coverageRatio * 100).toFixed(1)}%)`
    );

    for (let i = 1; i < merged.length; i++) {
      const gap = merged[i].s - merged[i - 1].e;
      assert.ok(gap <= 0.5, `Blank gap of ${gap.toFixed(2)}s found (max 0.5s allowed)`);
    }
  });

  it('still leaves a clean gap across genuinely long silence (>20s)', () => {
    const pauseWords = [
      { word: 'Hello', start: 0.0, end: 0.5 },
      { word: 'Goodbye.', start: 21.5, end: 22.0 },
    ];
    const pauseAss = generateAssSubtitles(pauseWords, 0, 30.0, { preset: 'cyber' });
    const pauseLines = pauseAss.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.equal(pauseLines.length, 2, 'Two isolated captions for a >20s silence');
    const first = pauseLines[0].split(',');
    assert.equal(first[2], '0:00:00.50', 'Caption must NOT hold across a 20s silence');
  });
});

describe('ASS Font Name Sanitization (regression: silent no-render bug)', () => {
  it('strips a CSS-style font stack down to a single family', () => {
    // A comma in the font name shifts every ASS style field and makes libass
    // render NO subtitles at all. Only the first family may be kept.
    assert.equal(sanitizeAssFontName('Montserrat, Arial'), 'Montserrat');
    assert.equal(sanitizeAssFontName('Montserrat, Trebuchet MS, Arial'), 'Montserrat');
    assert.equal(sanitizeAssFontName('Arial;Helvetica'), 'Arial');
  });

  it('keeps a plain single-family name untouched', () => {
    assert.equal(sanitizeAssFontName('Impact'), 'Impact');
    assert.equal(sanitizeAssFontName('Trebuchet MS'), 'Trebuchet MS');
  });

  it('falls back to a safe default for empty or invalid input', () => {
    assert.equal(sanitizeAssFontName(''), 'Arial');
    assert.equal(sanitizeAssFontName('   '), 'Arial');
    assert.equal(sanitizeAssFontName(null), 'Arial');
    assert.equal(sanitizeAssFontName(undefined), 'Arial');
    assert.equal(sanitizeAssFontName(123), 'Arial');
  });

  it('removes ASS-breaking and injectable characters', () => {
    const out = sanitizeAssFontName('Foo{bar}');
    assert.ok(!out.includes('{') && !out.includes('}'), 'braces must be stripped');
    assert.ok(!out.includes(','), 'commas must never survive');
  });

  it('generated style line never contains a comma inside the font field', () => {
    const words = [{ word: 'Hello', start: 0, end: 0.5 }];
    const ass = generateAssSubtitles(words, 0, 1.0, {
      preset: 'cyber',
      fontFamily: 'Montserrat, Arial',
    });
    const styleLine = ass.split('\n').find((l) => l.startsWith('Style: Default'));
    // Field 1 (index 1) is Fontname; it must be a clean single family.
    const fontField = styleLine.split(',')[1];
    assert.equal(fontField, 'Montserrat');
    assert.ok(!fontField.includes(','));
  });
});
