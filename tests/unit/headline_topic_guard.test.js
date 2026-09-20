import test from 'node:test';
import assert from 'node:assert';
import {
  stripEmptyOpeners,
  headlineHasTopic,
  headlineFromSpokenHook,
  applyMetadataToClips,
  viralPatterns,
} from '../../utils/metadataGenerator.js';

// ---------------------------------------------------------------------------
// The "greeting headline" bug.
//
// A clip's first spoken words are often a streamer's greeting. The model
// returned "Hello Ladies and Gentlemen" as the on-screen headline for an Apple
// unboxing clip. That headline does NOT repeat the title, so the existing
// repeat-guard waved it through — yet it says nothing about the video.
//
// Two layers now prevent it:
//   1. a topic guard: a headline made only of greeting/filler is rejected;
//   2. prompt rules forbidding greetings, with wrong/right examples.
// ---------------------------------------------------------------------------

const GREETINGS = [
  'Hello Ladies and Gentlemen',
  "What's Up Guys",
  'Welcome Back To The Stream',
  'Halo Semuanya',
  'Alright So Today',
  'Good Morning Everyone',
  'Hey Guys Welcome Back',
];

test('Greeting guard: a greeting is not a topic-bearing headline', async (t) => {
  await t.test('stripEmptyOpeners removes greetings and filler', () => {
    assert.strictEqual(stripEmptyOpeners('Hello ladies and gentlemen'), '');
    assert.strictEqual(stripEmptyOpeners("What's up guys"), '');
    assert.strictEqual(stripEmptyOpeners('Welcome back to the stream'), '');
    assert.strictEqual(stripEmptyOpeners('Halo semuanya'), '');
    assert.strictEqual(
      stripEmptyOpeners('Hello ladies and gentlemen. Today we unbox the package.'),
      'Today we unbox the package.'
    );
  });

  await t.test('headlineHasTopic rejects pure greetings', () => {
    for (const g of GREETINGS) {
      assert.strictEqual(
        headlineHasTopic(g), false,
        `"${g}" must be rejected as a headline (no topic)`
      );
    }
  });

  await t.test('headlineHasTopic accepts real topic statements', () => {
    for (const good of [
      'Mystery Apple Box Just Landed',
      'Today we unbox the mystery package',
      'Speed got a free iPhone from Apple',
    ]) {
      assert.strictEqual(headlineHasTopic(good), true, `"${good}" must be accepted`);
    }
  });

  await t.test('the spoken-hook fallback skips the greeting and uses the topic', () => {
    const title = 'Speed Unboxes Mystery Apple Care Package';
    const hook = 'Hello ladies and gentlemen. Today we unbox the mystery Apple care package.';
    const hl = headlineFromSpokenHook(hook, title);
    assert.ok(hl, 'must still produce a headline');
    assert.ok(
      !/hello|ladies and gentlemen/i.test(hl),
      `the greeting must be stripped, got: ${hl}`
    );
    assert.ok(/unbox|mystery|apple/i.test(hl), `headline must mention the topic, got: ${hl}`);
  });
});

test('Greeting guard: end-to-end metadata merge replaces a greeting headline', async (t) => {
  await t.test('the exact reported case is fixed', () => {
    // Reproduces the screenshot: model returned a greeting as the headline.
    const clips = [{
      index: 1,
      title: 'Speed Unboxes Mystery Apple Care Package',
      hookText: 'Hello ladies and gentlemen. Today we unbox the mystery Apple care package.',
      headline: 'Hello Ladies and Gentlemen',
    }];
    const meta = new Map([[1, {
      title: 'Speed Unboxes Mystery Apple Care Package',
      headline: 'Hello Ladies and Gentlemen',
      description: "A mysterious Apple care package lands in Speed's hands and the room erupts.",
      viralityScore: 99,
    }]]);

    const out = applyMetadataToClips(clips, meta);
    const h = out[0].headline;
    assert.ok(
      !/hello|ladies and gentlemen|welcome back/i.test(h),
      `headline must no longer be a greeting, got: ${h}`
    );
    assert.ok(h.length >= 8, 'headline must still be usable');
  });

  await t.test('a good model headline is left untouched', () => {
    const clips = [{
      index: 1,
      title: 'Speed Unboxes Mystery Apple Care Package',
      hookText: 'Hello ladies and gentlemen. Today we unbox the mystery package.',
    }];
    const meta = new Map([[1, {
      title: 'Speed Unboxes Mystery Apple Care Package',
      headline: 'Mystery Apple Box Just Landed',
      description: 'A mystery package arrives.',
      viralityScore: 99,
    }]]);

    const out = applyMetadataToClips(clips, meta);
    assert.strictEqual(out[0].headline, 'Mystery Apple Box Just Landed');
  });
});

test('Greeting guard: the prompt forbids greeting headlines', async (t) => {
  await t.test('the English pattern block spells out the ban', () => {
    const en = viralPatterns(true).join('\n');
    assert.ok(/NEVER A GREETING/i.test(en), 'must state the ban explicitly');
    assert.ok(/Hello Ladies and Gentlemen/.test(en), 'must show the wrong example');
    assert.ok(/Mystery Apple Box/i.test(en), 'must show the corrected example');
  });

  await t.test('the Indonesian pattern block spells out the ban', () => {
    const id = viralPatterns(false).join('\n');
    assert.ok(/JANGAN PERNAH SAPAAN/i.test(id), 'must state the ban explicitly');
    assert.ok(/Hello Ladies and Gentlemen/.test(id), 'must show the wrong example');
  });
});
