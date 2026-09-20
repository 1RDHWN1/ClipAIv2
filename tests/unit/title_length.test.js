import test from 'node:test';
import assert from 'node:assert';
import {
  trimTitleToTarget,
  normalizeClipMetadata,
  TITLE_MAX_CHARS,
  TITLE_TARGET_MIN_CHARS,
  TITLE_TARGET_MAX_CHARS,
} from '../../utils/metadataGenerator.js';

// ---------------------------------------------------------------------------
// Titles must be SHORT. A Shorts title is read in a fraction of a second and
// gets cut off in-feed, so a long title buries its own hook. The prompt asks
// for 28-40 chars; this suite proves the sanitiser enforces it even when the
// model ignores the instruction.
// ---------------------------------------------------------------------------

test('Title length: the prompt target is a hard-ish guarantee', async (t) => {
  await t.test('the constants are sane and ordered', () => {
    assert.ok(TITLE_TARGET_MIN_CHARS < TITLE_TARGET_MAX_CHARS);
    assert.ok(TITLE_TARGET_MAX_CHARS < TITLE_MAX_CHARS, 'target must be below the hard cap');
    assert.ok(TITLE_TARGET_MAX_CHARS <= 45, 'the target should be Shorts-friendly');
  });

  await t.test('a short title is returned untouched', () => {
    assert.strictEqual(trimTitleToTarget('Short Title'), 'Short Title');
    assert.strictEqual(
      trimTitleToTarget('They Want You Scared. Stay Anyway.'),
      'They Want You Scared. Stay Anyway.'
    );
  });

  await t.test('a complete first sentence beats a mid-thought cut', () => {
    // The whole first sentence is a real hook; the rest is padding.
    const out = trimTitleToTarget(
      'They Want You Scared. Stay Anyway. Here Is The Full Explanation Of It'
    );
    assert.strictEqual(out, 'They Want You Scared.');
  });

  await t.test('cuts at a clause boundary, never mid-phrase', () => {
    const out = trimTitleToTarget(
      'Obama Discusses the Importance of Convictions and Why It Matters Today'
    );
    assert.ok(out.length <= TITLE_MAX_CHARS, `got ${out.length} chars: ${out}`);
    // Must NOT be the broken fragment "Obama Discusses the Importance".
    assert.ok(
      !/^Obama Discusses the Importance$/.test(out),
      `must not cut mid-phrase, got: ${out}`
    );
  });

  await t.test('every long title lands under the hard cap', () => {
    const longTitles = [
      'This Is A Really Long Title That Just Keeps Going And Going Without Any Real Reason',
      'The One Habit That Separates People Who Succeed From Those Who Just Talk',
      'Why You Should Never Give Up On Your Beliefs Because It Defines Who You Are',
      'Obama Explains The Real Reason Most People Fail To Stand Up For What They Believe In',
    ];
    for (const title of longTitles) {
      const out = trimTitleToTarget(title) || title;
      assert.ok(
        out.length <= TITLE_MAX_CHARS,
        `"${title}" -> "${out}" (${out.length}) exceeds ${TITLE_MAX_CHARS}`
      );
    }
  });

  await t.test('never leaves a dangling stop-word or possessive', () => {
    const out = trimTitleToTarget(
      'The One Habit That Separates People Who Succeed From Those Who Talk'
    );
    assert.ok(out, 'must produce something');
    assert.ok(
      !/\b(your|our|their|the|and|of|to|from|who)$/i.test(out),
      `must not end on a dangling word, got: ${out}`
    );
  });

  await t.test('normalizeClipMetadata enforces the target end-to-end', () => {
    const meta = normalizeClipMetadata({
      title: 'This Is A Really Long Title That Just Keeps Going And Going Without Any Real Reason',
      caption: 'c',
    });
    assert.ok(meta.title.length <= TITLE_MAX_CHARS, `got ${meta.title.length}: ${meta.title}`);
  });

  await t.test('a title with nothing trimmable still respects the hard cap', () => {
    const meta = normalizeClipMetadata({ title: 'x'.repeat(TITLE_MAX_CHARS + 40), caption: 'c' });
    assert.strictEqual(meta.title.length, TITLE_MAX_CHARS);
  });

  await t.test('null / non-strings degrade safely', () => {
    assert.strictEqual(trimTitleToTarget(null), null);
    assert.strictEqual(trimTitleToTarget(undefined), null);
    assert.strictEqual(trimTitleToTarget(42), null);
  });
});
