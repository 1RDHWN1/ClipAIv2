import test from 'node:test';
import assert from 'node:assert';
import {
  viralPatterns,
  headlineRepeatsTitle,
  buildMetadataPrompt,
  applyMetadataToClips,
} from '../../utils/metadataGenerator.js';

// ---------------------------------------------------------------------------
// These tests pin the VIRAL PATTERN contract, reverse-engineered from five
// real Shorts whose view counts we measured (20K .. 16M). The rules are not
// opinions — each one cites the video that proves it.
// ---------------------------------------------------------------------------

test('Viral patterns: derived from real high-view Shorts', async (t) => {
  await t.test('the prompt block exists in both languages', () => {
    assert.ok(viralPatterns(true).length > 10, 'EN patterns must be substantial');
    assert.ok(viralPatterns(false).length > 10, 'ID patterns must be substantial');
  });

  await t.test('cites real view counts as evidence', () => {
    const en = viralPatterns(true).join('\n');
    assert.ok(/5\.4M/.test(en), 'must cite the 5.4M-view video');
    assert.ok(/16M/.test(en), 'must cite the 16M-view video');
    assert.ok(/20K/.test(en), 'must cite the 20K-view failure case');
  });

  await t.test('teaches specific numbers, personal stake, named targets', () => {
    const en = viralPatterns(true).join('\n').toLowerCase();
    assert.ok(en.includes('specific number'), 'must teach specific numbers');
    assert.ok(en.includes('personal stake'), 'must teach personal stake');
    assert.ok(en.includes('named target'), 'must teach naming the target');
    assert.ok(en.includes('open loop'), 'must teach the open loop');
  });

  await t.test('warns that the thumbnail must not repeat the title', () => {
    const en = viralPatterns(true).join('\n').toLowerCase();
    assert.ok(
      en.includes('thumbnail repeats title') || en.includes('must say different'),
      'must warn about the repeating-thumbnail failure mode'
    );
  });

  await t.test('separates the title job from the headline job', () => {
    const en = viralPatterns(true).join('\n').toLowerCase();
    assert.ok(en.includes('title vs headline'), 'must explain the two jobs');
    assert.ok(en.includes('must not repeat each other'), 'must forbid word overlap');
  });

  await t.test('the built prompt embeds the patterns', () => {
    const prompt = buildMetadataPrompt([{ index: 1, clipText: 'x' }], { language: 'en' });
    assert.ok(/PROVEN PATTERNS/.test(prompt), 'prompt must include the pattern block');
    assert.ok(/5\.4M views/.test(prompt), 'prompt must carry the evidence');
  });
});

test('Headline vs title: repeat detection', async (t) => {
  await t.test('flags an exact copy (the 20K-view failure)', () => {
    assert.strictEqual(
      headlineRepeatsTitle(
        'Penyebab Video Shorts Makin Sepi Penonton',
        'Penyebab Video Shorts Makin Sepi Penonton'
      ),
      true
    );
  });

  await t.test('flags a headline that is a PREFIX of the title', () => {
    assert.strictEqual(
      headlineRepeatsTitle(
        'Obama: They Want You Scared',
        'Obama: They Want You Scared. Stay Anyway.'
      ),
      true
    );
  });

  await t.test('allows a SHORT headline that distils the title (5.4M-view winner)', () => {
    assert.strictEqual(
      headlineRepeatsTitle('A Billion Views', 'How Much YouTube Paid Me For 1 Billion Views'),
      false
    );
  });

  await t.test('allows a genuinely different angle', () => {
    assert.strictEqual(
      headlineRepeatsTitle('Crime Isn\'t Insurrection', 'Obama: They Want You Scared. Stay Anyway.'),
      false
    );
  });

  await t.test('a repeated headline is replaced with the spoken hook', () => {
    const clips = [{ clipIndex: 1, title: 'Fallback', hookText: 'A totally different spoken line' }];
    const metaMap = new Map([[1, {
      title: 'Obama: They Want You Scared. Stay Anyway.',
      headline: 'Obama: They Want You Scared',
      caption: 'c',
    }]]);
    const out = applyMetadataToClips(clips, metaMap);
    assert.notStrictEqual(
      out[0].headline,
      'Obama: They Want You Scared',
      'a headline that just echoes the title must be swapped out'
    );
    assert.strictEqual(out[0].headline, 'A totally different spoken line');
  });

  await t.test('null / junk input never throws', () => {
    assert.strictEqual(headlineRepeatsTitle(null, 'x'), false);
    assert.strictEqual(headlineRepeatsTitle('x', null), false);
    assert.strictEqual(headlineRepeatsTitle('', ''), false);
  });
});
