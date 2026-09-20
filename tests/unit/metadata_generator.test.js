import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeMetadataMode,
  buildMetadataPrompt,
  normalizeClipMetadata,
  parseMetadataPayload,
  extractContent,
  applyMetadataToClips,
  generateClipMetadata,
  VALID_METADATA_MODES,
  DEFAULT_METADATA_MODE,
  TITLE_MAX_CHARS,
  HASHTAG_MAX_COUNT,
} from '../../utils/metadataGenerator.js';
import { buildClipTranscriptSlice } from '../../utils/transcriptSlice.js';

// ---------------------------------------------------------------------------
// Mode normalisation
// ---------------------------------------------------------------------------

test('Metadata mode: normalisation', async (t) => {
  await t.test('accepts every declared mode verbatim', () => {
    for (const mode of VALID_METADATA_MODES) {
      assert.strictEqual(normalizeMetadataMode(mode), mode);
    }
  });

  await t.test('is case- and whitespace-insensitive', () => {
    assert.strictEqual(normalizeMetadataMode('  ViRaL  '), 'viral');
    assert.strictEqual(normalizeMetadataMode('OFF'), 'off');
    assert.strictEqual(normalizeMetadataMode(' Seo '), 'seo');
  });

  await t.test('an unknown mode falls back to the default, never to off', () => {
    // A garbage form value must not silently disable metadata generation.
    assert.strictEqual(normalizeMetadataMode('banana'), DEFAULT_METADATA_MODE);
    assert.strictEqual(normalizeMetadataMode(''), DEFAULT_METADATA_MODE);
    assert.strictEqual(normalizeMetadataMode(undefined), DEFAULT_METADATA_MODE);
    assert.strictEqual(normalizeMetadataMode(null), DEFAULT_METADATA_MODE);
    assert.strictEqual(normalizeMetadataMode(42), DEFAULT_METADATA_MODE);
    assert.notStrictEqual(normalizeMetadataMode('banana'), 'off');
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

test('Metadata prompt: construction', async (t) => {
  const clips = [{ index: 1, title: 'T', hookText: 'H', clipText: 'spoken words here' }];

  await t.test('carries every clip index so the model answers per clip', () => {
    const prompt = buildMetadataPrompt(
      [{ index: 1, clipText: 'a' }, { index: 2, clipText: 'b' }, { index: 3, clipText: 'c' }],
      { language: 'id' }
    );
    assert.ok(prompt.includes('--- CLIP 1 ---'));
    assert.ok(prompt.includes('--- CLIP 2 ---'));
    assert.ok(prompt.includes('--- CLIP 3 ---'));
  });

  await t.test('demands JSON-only output with the full schema', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id' });
    for (const field of ['title', 'description', 'hashtags', 'caption', 'pinnedComment', 'trendKeywords']) {
      assert.ok(prompt.includes(field), `prompt should request "${field}"`);
    }
    assert.ok(/Respond ONLY with a valid JSON object/i.test(prompt));
  });

  await t.test('Indonesian dialogue gets an Indonesian-language directive', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/PETUNJUK BAHASA/.test(prompt));
    assert.ok(/bahasa Indonesia yang natural/.test(prompt));
    assert.ok(!/LANGUAGE REQUIREMENTS/.test(prompt));
  });

  await t.test('English dialogue gets an English-language directive', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'en' });
    assert.ok(/LANGUAGE REQUIREMENTS/.test(prompt));
    assert.ok(/natural, native English/.test(prompt));
    assert.ok(!/PETUNJUK BAHASA/.test(prompt));
  });

  await t.test('each style gets a materially different directive set', () => {
    const p = (m) => buildMetadataPrompt(clips, { language: 'id', metadataMode: m });
    const simple = p('simple');
    const seo = p('seo');
    const viral = p('viral');

    assert.ok(/GAYA = SEDERHANA/.test(simple));
    assert.ok(/GAYA = SEO-FIRST/.test(seo));
    assert.ok(/GAYA = VIRAL/.test(viral));

    // The three must not collapse into the same instructions.
    assert.notStrictEqual(simple, seo);
    assert.notStrictEqual(seo, viral);
    assert.notStrictEqual(simple, viral);
  });

  await t.test('viral style targets the visible 40-character window', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id', metadataMode: 'viral' });
    assert.ok(/40 karakter pertama/.test(prompt));
  });

  await t.test('forbids inventing facts — honesty is a hard rule', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/NEVER invent facts/.test(prompt));
  });

  await t.test('requires distinct titles across clips (anti-template guard)', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/DISTINCT/.test(prompt));
  });

  await t.test('threads the source video title in as trend context', () => {
    const prompt = buildMetadataPrompt(clips, { language: 'id', videoTitle: 'Jensen Huang on AI' });
    assert.ok(prompt.includes('Jensen Huang on AI'));
  });

  await t.test('platform targeting is reflected when specified', () => {
    const tiktok = buildMetadataPrompt(clips, { language: 'id', targetPlatform: 'tiktok' });
    assert.ok(/tiktok/.test(tiktok));
    const all = buildMetadataPrompt(clips, { language: 'id', targetPlatform: 'all' });
    assert.ok(/TikTok \/ YouTube Shorts \/ Instagram Reels/.test(all));
  });

  await t.test('rejects an empty clip list rather than emitting a broken prompt', () => {
    assert.throws(() => buildMetadataPrompt([], {}), /non-empty array/);
    assert.throws(() => buildMetadataPrompt(null, {}), /non-empty array/);
  });
});

// ---------------------------------------------------------------------------
// Response sanitisation
// ---------------------------------------------------------------------------

test('Metadata normalisation: hostile model output', async (t) => {
  await t.test('normalises hashtags: adds #, strips punctuation, de-dupes case-insensitively', () => {
    const meta = normalizeClipMetadata({
      title: 'Judul',
      hashtags: ['viral', '#Viral', '#ai 2024', '!!!', '##', 'a', '#bisnis digital'],
    });
    assert.deepStrictEqual(meta.hashtags, ['#viral', '#ai2024', '#bisnisdigital']);
  });

  await t.test('caps the hashtag list at the platform limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => `tag${i}`);
    const meta = normalizeClipMetadata({ title: 'T', hashtags: many });
    assert.strictEqual(meta.hashtags.length, HASHTAG_MAX_COUNT);
  });

  await t.test('truncates an over-long title instead of dropping it', () => {
    const long = 'x'.repeat(TITLE_MAX_CHARS + 60);
    const meta = normalizeClipMetadata({ title: long });
    assert.strictEqual(meta.title.length, TITLE_MAX_CHARS);
    assert.ok(meta.title.endsWith('…'));
  });

  await t.test('tolerates a hashtags field that is not an array', () => {
    const meta = normalizeClipMetadata({ title: 'T', hashtags: 'viral, ai' });
    assert.deepStrictEqual(meta.hashtags, []);
  });

  await t.test('returns null for an empty/garbage object so callers keep the old title', () => {
    assert.strictEqual(normalizeClipMetadata({}), null);
    assert.strictEqual(normalizeClipMetadata({ title: '   ' }), null);
    assert.strictEqual(normalizeClipMetadata(null), null);
    assert.strictEqual(normalizeClipMetadata('a string'), null);
    assert.strictEqual(normalizeClipMetadata(123), null);
  });

  await t.test('caps trendKeywords and drops non-strings', () => {
    const meta = normalizeClipMetadata({
      title: 'T',
      trendKeywords: ['a', 'b', null, 42, 'c', 'd', 'e', 'f', 'g', 'h'],
    });
    assert.ok(meta.trendKeywords.length <= 8);
    assert.ok(meta.trendKeywords.every((k) => typeof k === 'string'));
  });
});

// ---------------------------------------------------------------------------
// Tolerant JSON parsing
// ---------------------------------------------------------------------------

test('Metadata parsing: tolerant of real gateway output', async (t) => {
  await t.test('parses a bare JSON object', () => {
    const parsed = parseMetadataPayload('{"clips":[{"index":1,"title":"A"}]}');
    assert.strictEqual(parsed.clips[0].title, 'A');
  });

  await t.test('parses a fenced ```json block', () => {
    const parsed = parseMetadataPayload('```json\n{"clips":[{"index":1,"title":"B"}]}\n```');
    assert.strictEqual(parsed.clips[0].title, 'B');
  });

  await t.test('parses a fenced block with no language tag', () => {
    const parsed = parseMetadataPayload('```\n{"clips":[{"index":1,"title":"C"}]}\n```');
    assert.strictEqual(parsed.clips[0].title, 'C');
  });

  await t.test('recovers a JSON object wrapped in prose', () => {
    const parsed = parseMetadataPayload('Sure! Here you go:\n{"clips":[{"index":1,"title":"D"}]}\nHope that helps.');
    assert.strictEqual(parsed.clips[0].title, 'D');
  });

  await t.test('throws on genuinely unparseable output', () => {
    assert.throws(() => parseMetadataPayload('not json at all'), /gagal mem-parsing/);
    assert.throws(() => parseMetadataPayload(''), /kosong/);
    assert.throws(() => parseMetadataPayload(null), /kosong/);
  });

  await t.test('extractContent unwraps string, array and reasoning shapes', () => {
    assert.strictEqual(extractContent({ choices: [{ message: { content: 'plain' } }] }), 'plain');
    assert.strictEqual(
      extractContent({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }),
      'a\nb'
    );
    assert.strictEqual(
      extractContent({ choices: [{ message: { reasoning: 'reasoned' } }] }),
      'reasoned'
    );
    assert.strictEqual(extractContent({}), '');
  });
});

// ---------------------------------------------------------------------------
// Merging back onto clips
// ---------------------------------------------------------------------------

test('Metadata merge: never loses a title, never crashes', async (t) => {
  const clips = [
    { clipIndex: 1, title: 'Analyzer Title 1', filename: 'a.mp4' },
    { clipIndex: 2, title: 'Analyzer Title 2', filename: 'b.mp4' },
  ];

  await t.test('an empty metadata map leaves titles intact and sets metadata null', () => {
    const out = applyMetadataToClips(clips, new Map());
    assert.strictEqual(out[0].title, 'Analyzer Title 1');
    assert.strictEqual(out[0].metadata, null);
    assert.strictEqual(out.length, 2);
  });

  await t.test('a generated title wins over the analyzer title', () => {
    const map = new Map([[1, { title: 'Viral Title' }]]);
    const out = applyMetadataToClips(clips, map);
    assert.strictEqual(out[0].title, 'Viral Title');
    // Clip 2 had no generated metadata -> keeps its analyzer title.
    assert.strictEqual(out[1].title, 'Analyzer Title 2');
    assert.strictEqual(out[1].metadata, null);
  });

  await t.test('metadata with no title falls back to the analyzer title (never blank)', () => {
    const map = new Map([[1, { title: null, description: 'desc only' }]]);
    const out = applyMetadataToClips(clips, map);
    assert.strictEqual(out[0].title, 'Analyzer Title 1');
    assert.strictEqual(out[0].metadata.description, 'desc only');
  });

  await t.test('tolerates a null map and a non-array input', () => {
    assert.strictEqual(applyMetadataToClips(clips, null)[0].metadata, null);
    assert.strictEqual(applyMetadataToClips(null, new Map()), null);
  });
});

// ---------------------------------------------------------------------------
// generateClipMetadata orchestration (injected transport, no network)
// ---------------------------------------------------------------------------

test('generateClipMetadata: orchestration and failure isolation', async (t) => {
  const clipInputs = [{ index: 1, title: 'A' }, { index: 2, title: 'B' }];

  await t.test('mode=off short-circuits without any request', async () => {
    let called = false;
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'off',
      requestFn: async () => { called = true; return { clips: [] }; },
    });
    assert.strictEqual(called, false, 'off mode must not call the model');
    assert.strictEqual(map.size, 0);
  });

  await t.test('parses a successful single batch call into a Map keyed by index', async () => {
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'viral',
      requestFn: async () => ({
        clips: [
          { index: 1, title: 'One', hashtags: ['viral'] },
          { index: 2, title: 'Two', hashtags: ['#ai'] },
        ],
      }),
    });
    assert.strictEqual(map.size, 2);
    assert.strictEqual(map.get(1).title, 'One');
    assert.strictEqual(map.get(2).title, 'Two');
  });

  await t.test('issues ONE request for N clips (flat cost, not per-clip)', async () => {
    let calls = 0;
    const many = Array.from({ length: 5 }, (_, i) => ({ index: i + 1, title: `C${i + 1}` }));
    await generateClipMetadata(many, {
      metadataMode: 'viral',
      requestFn: async () => {
        calls += 1;
        return { clips: many.map((c) => ({ index: c.index, title: `T${c.index}` })) };
      },
    });
    assert.strictEqual(calls, 1, 'metadata generation must batch all clips into one call');
  });

  await t.test('retries without JSON mode after a JSON-mode rejection', async () => {
    const attempts = [];
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'viral',
      requestFn: async ({ useJsonMode }) => {
        attempts.push(useJsonMode);
        if (useJsonMode) throw new Error('response_format unsupported');
        return { clips: [{ index: 1, title: 'Recovered' }] };
      },
    });
    assert.deepStrictEqual(attempts, [true, false]);
    assert.strictEqual(map.get(1).title, 'Recovered');
  });

  await t.test('returns an EMPTY map instead of throwing when every attempt fails', async () => {
    // The render must survive a dead metadata gateway.
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'viral',
      requestFn: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 0);
  });

  await t.test('drops clips with a missing/non-numeric index but keeps the valid ones', async () => {
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'viral',
      requestFn: async () => ({
        clips: [
          { index: 1, title: 'Good' },
          { title: 'No index' },
          { index: 'nope', title: 'Bad index' },
          { index: 2, title: 'Also good' },
        ],
      }),
    });
    assert.strictEqual(map.size, 2);
    assert.strictEqual(map.get(1).title, 'Good');
    assert.strictEqual(map.get(2).title, 'Also good');
  });

  await t.test('empty clip input list is a no-op', async () => {
    let called = false;
    const map = await generateClipMetadata([], {
      metadataMode: 'viral',
      requestFn: async () => { called = true; return { clips: [] }; },
    });
    assert.strictEqual(called, false);
    assert.strictEqual(map.size, 0);
  });

  await t.test('parse failure of a malformed payload degrades to an empty map', async () => {
    const map = await generateClipMetadata(clipInputs, {
      metadataMode: 'viral',
      // No `clips` array at all.
      requestFn: async () => ({ unexpected: true }),
    });
    assert.strictEqual(map.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Transcript slicing (gives metadata generator real clip content)
// ---------------------------------------------------------------------------

test('Clip transcript slice: real dialogue context for the metadata model', async (t) => {
  const sentences = [
    { start: 0, end: 5, text: 'Nol sampai lima.' },
    { start: 5, end: 10, text: 'Lima sampai sepuluh.' },
    { start: 10, end: 15, text: 'Sepuluh sampai lima belas.' },
    { start: 20, end: 25, text: 'Di luar rentang.' },
  ];

  await t.test('keeps only sentences overlapping the clip window', () => {
    const slice = buildClipTranscriptSlice(sentences, 4, 12);
    assert.ok(slice.includes('Nol sampai lima.'));
    assert.ok(slice.includes('Lima sampai sepuluh.'));
    assert.ok(slice.includes('Sepuluh sampai lima belas.'));
    assert.ok(!slice.includes('Di luar rentang.'));
  });

  await t.test('returns empty string for invalid windows instead of guessing', () => {
    assert.strictEqual(buildClipTranscriptSlice(sentences, 10, 5), '');
    assert.strictEqual(buildClipTranscriptSlice(sentences, NaN, 5), '');
    assert.strictEqual(buildClipTranscriptSlice([], 0, 10), '');
    assert.strictEqual(buildClipTranscriptSlice(null, 0, 10), '');
  });

  await t.test('truncates a very long slice at a word boundary', () => {
    const long = Array.from({ length: 400 }, () => ({ start: 0, end: 1, text: 'kata '.repeat(5) }));
    const slice = buildClipTranscriptSlice(long, 0, 10, 200);
    assert.ok(slice.length <= 201, `expected <=201 chars, got ${slice.length}`);
    assert.ok(slice.endsWith('…'));
    assert.ok(!/\s$/.test(slice.slice(0, -1)));
  });

  await t.test('ignores malformed sentence entries without throwing', () => {
    const messy = [
      { start: 0, end: 5, text: 'valid' },
      null,
      { start: 'x', end: 'y', text: 'bad numbers' },
      { start: 1, end: 2, text: '' },
    ];
    const slice = buildClipTranscriptSlice(messy, 0, 10);
    assert.strictEqual(slice, 'valid');
  });
});
