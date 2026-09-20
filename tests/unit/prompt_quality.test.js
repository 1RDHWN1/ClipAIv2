import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMetadataPrompt, generateClipMetadata, applyMetadataToClips } from '../../utils/metadataGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// These tests pin the ANTI-FLAT contract of the publishing prompt.
//
// The old prompt produced templated, low-effort output that the user called
// "flat": captions like "Mari simak poin penting ini: <title>", hashtags
// limited to "#viral #shorts #reels #podcast", and generic engagement bait.
// The rules below exist to keep that from coming back.
// ---------------------------------------------------------------------------

const clips = [
  {
    index: 1,
    title: 'Obama: Your Convictions Are Being Tested Right Now',
    hookText: 'we all have this capacity to take a stand',
    clipText: 'if our convictions do not cost us anything, they are just fashion',
    duration: 76,
  },
];

test('Publishing prompt: anti-flat contract', async (t) => {
  await t.test('bans meta openers by name', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    // The exact phrase the user flagged as flat must be explicitly forbidden.
    assert.ok(/Mari simak/.test(p), 'the banned flat opener must be named so the model avoids it');
    assert.ok(/TERLARANG/i.test(p), 'banned openers must be marked as forbidden');
    assert.ok(/Dalam video ini/.test(p), 'English/ID meta openers must be listed');
  });

  await t.test('bans generic engagement bait in the pinned comment', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/PINNED COMMENT HARUS SPESIFIK/i.test(p));
    assert.ok(/Bagaimana menurut kalian/.test(p), 'the generic bait phrase must be shown as banned');
  });

  await t.test('demands specific hashtags, not only the generic set', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/HASHTAG HARUS BERGUNA/i.test(p));
    assert.ok(/#shorts #podcast/.test(p), 'broad tags are still expected');
    assert.ok(/#kepemimpinan/.test(p), 'specific topical tags must be required');
  });

  await t.test('shows a FLAT vs HOOK comparison so the model has a concrete target', () => {
    const p = buildMetadataPrompt(clips, { language: 'en' });
    assert.ok(/FLAT vs SCROLL-STOPPING/.test(p));
    assert.ok(/FLAT caption/.test(p));
    assert.ok(/HOOK caption/.test(p));
  });

  await t.test('requires the caption to work as a standalone hook', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/CAPTION BUKAN LABEL/i.test(p));
    assert.ok(/tanpa konteks video|ZERO context/i.test(p));
  });

  await t.test('forbids the "<generic intro>: <title>" pattern explicitly', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/<pembuka generik>: <judul>/.test(p), 'the flat template must be called out verbatim');
  });

  await t.test('pins the output language to the CONTENT language (en)', () => {
    const p = buildMetadataPrompt(clips, { language: 'en' });
    assert.ok(/clip dialogue is in ENGLISH/i.test(p));
    assert.ok(/Do NOT mix in Indonesian/i.test(p), 'EN content must not yield Indonesian metadata');
  });

  await t.test('pins the output language to the CONTENT language (id)', () => {
    const p = buildMetadataPrompt(clips, { language: 'id' });
    assert.ok(/Dialog klip dalam bahasa INDONESIA/i.test(p));
    assert.ok(/JANGAN campur bahasa Inggris/i.test(p));
  });

  await t.test('a non-en language code never falls back to the English block', () => {
    // "jv" (Javanese) is not English, so it must get the Indonesian-style rules.
    const p = buildMetadataPrompt(clips, { language: 'jv' });
    assert.ok(/PETUNJUK BAHASA/.test(p));
    assert.ok(!/clip dialogue is in ENGLISH/i.test(p));
  });
});

test('Publishing prompt: language is derived, not hardcoded', async (t) => {
  await t.test('an English clip is requested in English', () => {
    const p = buildMetadataPrompt(clips, { language: 'en' });
    assert.ok(/in natural, native English/i.test(p));
  });

  await t.test('generateClipMetadata forwards the language into the prompt', async () => {
    // Injection seam: capture the prompt instead of calling the network.
    let captured = null;
    const requestFn = async ({ prompt }) => {
      captured = prompt;
      return { clips: [{ index: 1, title: 'T', caption: 'C' }] };
    };

    await generateClipMetadata(clips, {
      language: 'en',
      metadataMode: 'viral',
      requestFn,
    });

    assert.ok(captured, 'the request function must receive a prompt');
    assert.ok(/in natural, native English/i.test(captured));
    assert.ok(!/PETUNJUK BAHASA/.test(captured), 'EN must not receive the Indonesian rule block');
  });
});

// ---------------------------------------------------------------------------
// Regression: generated metadata must actually REACH the clip.
//
// The worker generates metadata for the analyzer's clips, which carry only
// start/end — no clipIndex. applyMetadataToClips matches on clipIndex, so
// without tagging the index first the merge silently returned metadata: null
// for every clip: the UI showed no caption/hashtags at all even though the
// generator logged success.
// ---------------------------------------------------------------------------

test('Metadata merge: analyzer clips must be index-tagged first', async (t) => {
  await t.test('an untagged analyzer clip loses its metadata (the old bug)', () => {
    const analyzerClips = [{ title: 'T', start: 0, end: 10 }]; // no clipIndex
    const metaMap = new Map([[1, { title: 'New', caption: 'C' }]]);
    const out = applyMetadataToClips(analyzerClips, metaMap);
    assert.strictEqual(
      out[0].metadata,
      null,
      'documents WHY the worker must tag clipIndex before merging'
    );
  });

  await t.test('tagging clipIndex makes the metadata stick', () => {
    const tagged = [{ title: 'T', start: 0, end: 10, clipIndex: 1 }];
    const metaMap = new Map([[1, { title: 'New', caption: 'C', hashtags: ['#x'] }]]);
    const out = applyMetadataToClips(tagged, metaMap);
    assert.ok(out[0].metadata, 'metadata must survive the merge');
    assert.strictEqual(out[0].metadata.caption, 'C');
    assert.strictEqual(out[0].title, 'New');
  });

  await t.test('the worker tags clipIndex before calling applyMetadataToClips', () => {
    const src = readFileSync(
      path.join(__dirname, '..', '..', 'workers', 'videoWorker.js'),
      'utf-8'
    );
    // The tag must exist and must precede the merge call.
    const tagIdx = src.indexOf('clipIndex: c.clipIndex ?? (i + 1)');
    const mergeIdx = src.indexOf('applyMetadataToClips(enrichedClips, metadataByIndex)');
    assert.ok(tagIdx > -1, 'the worker must tag clipIndex on analyzer clips');
    assert.ok(mergeIdx > -1, 'the worker must merge into the tagged list');
    assert.ok(tagIdx < mergeIdx, 'tagging must happen BEFORE the merge');
  });
});
