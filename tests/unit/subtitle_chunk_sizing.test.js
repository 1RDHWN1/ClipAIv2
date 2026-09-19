// tests/unit/subtitle_chunk_sizing.test.js
import test from 'node:test';
import assert from 'node:assert';

import {
  chunkWords,
  deriveMaxCharsPerChunk,
  generateAssSubtitles,
  VIRAL_PRESETS,
} from '../../utils/subtitleGenerator.js';

/**
 * Regression: subtitle chunk sizing (audit finding M2), two defects.
 *
 * M2a — the character cap was the hardcoded constant 26 regardless of font
 *       size. At the mrbeast preset (fontSize 84, uppercase Impact) 26
 *       uppercase glyphs measure ~1000px on a 1080px-wide canvas, so captions
 *       ran off the frame edge. Measured with a real render:
 *         fontSize 84  -> ~927px  (in frame)
 *         fontSize 84, 26 forced -> ~1080px (at/over the edge)
 *
 * M2b — `isMaxChars` required `current.length >= 2`, which disabled the cap
 *       whenever the current chunk held a single word. Two long words such as
 *       "CHARACTERISTIC MISUNDERSTANDING" (31 chars) therefore passed a 24-char
 *       cap untouched.
 */

const mkWords = (list) =>
  list.map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.35 }));

const chunkChars = (chunk) => chunk.map((w) => w.word).join(' ').length;

test('Subtitle chunk sizing: char cap follows font size (M2a)', async (t) => {
  await t.test('Case 1: larger font sizes yield a smaller character cap', () => {
    const small = deriveMaxCharsPerChunk(68);
    const medium = deriveMaxCharsPerChunk(80);
    const large = deriveMaxCharsPerChunk(84);

    assert.ok(small >= medium, 'smaller font must allow at least as many chars');
    assert.ok(medium >= large, 'larger font must not allow more chars');
    assert.ok(large < small, 'cap must actually shrink with font size');
  });

  await t.test('Case 2: derived cap keeps every real preset inside the canvas', () => {
    const CANVAS = 1080;
    const SAFE = 940; // canvas minus margins
    for (const [name, preset] of Object.entries(VIRAL_PRESETS)) {
      const chars = deriveMaxCharsPerChunk(preset.fontSize);
      const approxPx = chars * preset.fontSize * 0.46;
      assert.ok(
        approxPx <= SAFE,
        `preset ${name}: ${chars} chars @${preset.fontSize} = ~${approxPx.toFixed(0)}px exceeds safe ${SAFE}px`
      );
      assert.ok(approxPx <= CANVAS, `preset ${name} would overflow the canvas`);
    }
  });

  await t.test('Case 3: cap is clamped to a sane range for extreme inputs', () => {
    assert.ok(deriveMaxCharsPerChunk(5) <= 30, 'tiny font must not produce absurd caps');
    assert.ok(deriveMaxCharsPerChunk(500) >= 12, 'huge font must keep a usable minimum');
    assert.strictEqual(deriveMaxCharsPerChunk(NaN), 30);
    assert.strictEqual(deriveMaxCharsPerChunk(0), 30);
    assert.strictEqual(deriveMaxCharsPerChunk(undefined), 30);
  });

  await t.test('Case 4: an explicit maxCharsPerChunk is still honoured verbatim', () => {
    const words = mkWords(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX']);
    const chunks = chunkWords(words, 0, 60, { fontSize: 84, maxCharsPerChunk: 5 });
    // Each single word is <= 5 chars, so every chunk must hold exactly one word.
    for (const c of chunks) {
      assert.ok(chunkChars(c) <= 5, `chunk "${c.map((w) => w.word).join(' ')}" exceeds explicit cap 5`);
    }
  });
});

test('Subtitle chunk sizing: char cap binds from the first word (M2b)', async (t) => {
  await t.test('Case 1: two long words never share a chunk past the cap', () => {
    const words = mkWords(['CHARACTERISTIC', 'MISUNDERSTANDING', 'EXTRAORDINARY', 'TRANSFORMATION']);
    const chunks = chunkWords(words, 0, 60, { fontSize: 84, maxCharsPerChunk: 24 });

    for (const c of chunks) {
      const size = chunkChars(c);
      // A single word may exceed the cap (it cannot be split), but two words
      // together must never do so.
      if (c.length > 1) {
        assert.ok(size <= 24, `multi-word chunk "${c.map((w) => w.word).join(' ')}" is ${size} chars (cap 24)`);
      }
    }
  });

  await t.test('Case 2: the old 31-char pairing is gone', () => {
    const words = mkWords(['CHARACTERISTIC', 'MISUNDERSTANDING']);
    const chunks = chunkWords(words, 0, 60, { preset: 'mrbeast' });
    const joined = chunks.map((c) => c.map((w) => w.word).join(' '));
    assert.ok(
      !joined.includes('CHARACTERISTIC MISUNDERSTANDING'),
      'the 31-character pairing that overflowed the canvas must no longer be produced'
    );
  });

  await t.test('Case 3: a single unsplittable monster word is still emitted', () => {
    const words = mkWords(['PNEUMONOULTRAMICROSCOPICSILICOVOLCANOCONIOSIS']);
    const chunks = chunkWords(words, 0, 60, { maxCharsPerChunk: 24 });
    assert.strictEqual(chunks.length, 1, 'the word must not be dropped');
    assert.strictEqual(chunks[0].length, 1);
  });

  await t.test('Case 4: content within the cap is preserved, not split', () => {
    // "ABCDE FGHIJ" renders as 11 visible chars. The chunker projects
    // `len + 1` per word (the +1 accounts for the separating space), so a 11
    // char pair projects 12 and correctly needs a 12-char cap to stay together.
    const words = mkWords(['ABCDE', 'FGHIJ']);
    const kept = chunkWords(words, 0, 60, { maxCharsPerChunk: 12 });
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(chunkChars(kept[0]), 11);

    // With a cap of 11 the projected 12 exceeds it, so they must separate.
    const split = chunkWords(words, 0, 60, { maxCharsPerChunk: 11 });
    assert.strictEqual(split.length, 2);
  });

  await t.test('Case 5: generated ASS never emits a multi-word caption past the derived cap', () => {
    // Deliberately include SHORT words so genuinely multi-word chunks exist and
    // the assertion below has something to verify (long words each become their
    // own chunk and would make this test vacuously pass).
    const words = mkWords([
      'THE', 'REAL', 'STORY', 'OF', 'HOW', 'WE', 'BUILT', 'THIS',
      'EXTRAORDINARY', 'PRODUCT', 'FOR', 'EVERY', 'SINGLE', 'PERSON',
      'WHO', 'NEEDED', 'IT', 'TODAY',
    ]);
    const ass = generateAssSubtitles(words, 0, 60, { preset: 'mrbeast' });
    const cap = deriveMaxCharsPerChunk(VIRAL_PRESETS.mrbeast.fontSize);

    // ASS Dialogue format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    // Text is field index 9 and may itself contain commas, so re-join the tail.
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.ok(dialogues.length > 0, 'test must actually find captions to inspect');

    let multiWordCount = 0;
    for (const line of dialogues) {
      const fields = line.slice('Dialogue:'.length).split(',');
      const text = fields.slice(9).join(',');
      const plain = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim();
      const wordCount = plain.split(/\s+/).filter(Boolean).length;
      if (wordCount > 1) {
        multiWordCount++;
        assert.ok(plain.length <= cap, `caption "${plain}" is ${plain.length} chars (cap ${cap})`);
      }
    }

    // Guard against a false pass: if parsing silently produced empty strings, or
    // every word happened to be long enough to occupy its own chunk, the loop
    // above would assert nothing at all.
    assert.ok(multiWordCount > 0, 'expected at least one multi-word caption to verify');
  });
});
